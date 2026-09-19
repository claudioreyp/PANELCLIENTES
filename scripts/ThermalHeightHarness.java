import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Callable;
import java.util.concurrent.FutureTask;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import javafx.application.Platform;
import javafx.animation.AnimationTimer;
import javafx.embed.swing.SwingFXUtils;
import javafx.scene.web.WebView;
import javafx.stage.Stage;
import org.codehaus.jettison.json.JSONArray;
import org.codehaus.jettison.json.JSONObject;
import qz.printer.action.html.WebApp;
import qz.printer.action.html.WebAppModel;

/** Source-file launcher: renderer only. Never starts qz.App, a socket or a printer job. */
class ThermalHeightHarness {
    private static WebView webView;

    public static void main(String[] args) throws Throwable {
        if (args.length != 1) throw new IllegalArgumentException("Expected isolated fixture manifest");
        Path manifest = Path.of(args[0]).toAbsolutePath().normalize();
        Path output = manifest.getParent();
        JSONArray fixtures = new JSONArray(Files.readString(manifest, StandardCharsets.UTF_8));
        JSONArray results = new JSONArray();
        try {
            WebApp.initialize();
            Field field = WebApp.class.getDeclaredField("webView");
            field.setAccessible(true);
            webView = (WebView)field.get(null);
            for (int i = 0; i < fixtures.length(); i++) {
                JSONObject fixture = fixtures.getJSONObject(i);
                String name = fixture.getString("name");
                if (!name.matches("[a-z0-9-]+")) throw new IllegalArgumentException("Invalid fixture name");
                String html = Files.readString(output.resolve(name + ".html"), StandardCharsets.UTF_8);
                int width = fixture.getInt("rasterWidth");
                int height = fixture.getInt("pageHeightDots");
                double mm = fixture.getDouble("paperWidth");
                double cssPerDot = mm * 96 / 25.4 / width;
                // Diagnostic baseline only: reproduce the old omitted-pageHeight branch.
                BufferedImage automatic = raster(html, width, 0, mm);
                BufferedImage fixed = raster(html, width, height, mm);
                JSONObject fixedDom = dimensions();
                // Enlarge the already rendered WebView without reloading or changing its effective zoom.
                // A second WebApp.raster call would lower zoom again for memory and invalidate this oracle.
                int referenceHeight = Math.max(height * 2, (int)Math.ceil(fixedDom.getDouble("bottom") / cssPerDot) + 1024);
                BufferedImage reference = expandedReference(width, referenceHeight);
                JSONObject referenceDom = dimensions();
                BufferedImage repeated = raster(html, width, height, mm);
                JSONObject fixedInk = ink(fixed), referenceInk = ink(reference), repeatedInk = ink(repeated);
                boolean stableLayout = Math.abs(fixedDom.getDouble("bottom") - referenceDom.getDouble("bottom")) < 0.1
                    && Math.abs(fixedDom.getDouble("width") - referenceDom.getDouble("width")) < 0.01;
                boolean clipped = !stableLayout || referenceInk.getInt("lastRow") >= fixed.getHeight()
                    || fixedInk.getInt("lastRow") >= fixed.getHeight() - 1;
                JSONObject result = new JSONObject().put("name", name).put("paperWidth", mm)
                    .put("browserHeightCssPx", fixture.getDouble("heightCssPx"))
                    .put("pageHeightDots", height).put("rasterWidth", fixed.getWidth()).put("rasterHeight", fixed.getHeight())
                    .put("automaticRasterHeight", automatic.getHeight()).put("automaticInk", ink(automatic))
                    .put("javaRuntime", System.getProperty("java.runtime.version"))
                    .put("fixedDom", fixedDom).put("referenceDom", referenceDom)
                    .put("fixedInk", fixedInk).put("referenceInk", referenceInk).put("repeatedInk", repeatedInk)
                    .put("bottomClipped", clipped).put("stableLayout", stableLayout)
                    .put("heightDeltaCssPx", fixedDom.getDouble("bottom") - fixture.getDouble("heightCssPx"));
                results.put(result);
                // Only synthetic renderer artifacts; never customer data or UI screenshots.
                ImageIO.write(fixed, "png", output.resolve(name + "-fixed.png").toFile());
                ImageIO.write(reference, "png", output.resolve(name + "-reference.png").toFile());
                Files.writeString(output.resolve("javafx-results.json"), results.toString(2), StandardCharsets.UTF_8);
                System.out.println(result.toString());
            }
        } finally {
            Platform.exit();
        }
    }

    private static BufferedImage raster(String html, int width, int height, double mm) throws Throwable {
        double dpi = width / mm * 25.4;
        WebAppModel model = new WebAppModel(html, true, width / dpi * 72, height / dpi * 72, false, dpi / 72);
        if (Math.abs(model.getWebWidth() - mm * 96 / 25.4) > 0.000001
            || Math.abs(model.getWebHeight() - height * mm * 96 / 25.4 / width) > 0.000001) {
            throw new IllegalStateException("Installed QZ does not use the expected CSS unit conversion");
        }
        BufferedImage snapshot = WebApp.raster(model);
        return scaleRaw(snapshot, width);
    }

    private static BufferedImage scaleRaw(BufferedImage snapshot, int width) {
        // Exact RAW HTML downsampling used by QZ PrintHTML.createBufferedImage.
        double factor = (double)width / snapshot.getWidth();
        BufferedImage scaled = new BufferedImage((int)(snapshot.getWidth() * factor), (int)(snapshot.getHeight() * factor), BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = scaled.createGraphics();
        graphics.drawImage(snapshot, 0, 0, scaled.getWidth(), scaled.getHeight(), null);
        graphics.dispose();
        return scaled;
    }

    private static BufferedImage expandedReference(int width, int height) throws Exception {
        CompletableFuture<BufferedImage> future = new CompletableFuture<>();
        Platform.runLater(() -> {
            Stage stage = (Stage)webView.getScene().getWindow();
            // Showing QZ's 1x1 utility stage briefly resets its root's size. Retain the
            // rendered width first, then restore the exact constraints after showing it.
            double viewWidth = webView.getWidth();
            double viewHeight = height * viewWidth / width;
            stage.show();
            webView.setMinSize(viewWidth, viewHeight);
            webView.setPrefSize(viewWidth, viewHeight);
            webView.setMaxSize(viewWidth, viewHeight);
            webView.autosize();
            new AnimationTimer() {
                int frames;
                public void handle(long now) {
                    if (++frames < 3) return;
                    stop();
                    try { future.complete(SwingFXUtils.fromFXImage(webView.snapshot(null, null), null)); }
                    catch (Throwable error) { future.completeExceptionally(error); }
                    finally { stage.hide(); }
                }
            }.start();
        });
        return scaleRaw(future.get(15, TimeUnit.SECONDS), width);
    }

    private static JSONObject dimensions() throws Exception {
        return new JSONObject(onFx(() -> (String)webView.getEngine().executeScript("""
            JSON.stringify((function() {
                var e = document.querySelector('.thermal-document');
                var r = e.getBoundingClientRect(), s = getComputedStyle(e);
                return { width: r.width, bottom: r.bottom, scrollHeight: e.scrollHeight,
                    bodyScrollHeight: document.body.scrollHeight, fontSize: s.fontSize,
                    fontFamily: s.fontFamily,
                    itemCount: e.querySelectorAll('.thermal-item').length };
            })())
            """))).put("effectiveZoom", WebApp.getZoom())
            .put("viewWidth", onFx(() -> webView.getWidth())).put("viewHeight", onFx(() -> webView.getHeight()));
    }

    private static <T> T onFx(Callable<T> work) throws Exception {
        FutureTask<T> future = new FutureTask<>(work);
        Platform.runLater(future);
        return future.get(15, TimeUnit.SECONDS);
    }

    private static JSONObject ink(BufferedImage image) throws Exception {
        int first = -1, last = -1, rows = 0, pixels = 0;
        for (int y = 0; y < image.getHeight(); y++) {
            boolean any = false;
            for (int x = 0; x < image.getWidth(); x++) {
                int rgba = image.getRGB(x, y);
                int alpha = (rgba >>> 24) & 255;
                int luma = (((rgba >>> 16) & 255) * 299 + ((rgba >>> 8) & 255) * 587 + (rgba & 255) * 114) / 1000;
                int onWhite = (luma * alpha + 255 * (255 - alpha)) / 255;
                if (onWhite < 200) { any = true; pixels++; }
            }
            if (any) { if (first < 0) first = y; last = y; rows++; }
        }
        return new JSONObject().put("firstRow", first).put("lastRow", last).put("inkRows", rows)
            .put("inkPixels", pixels).put("tailRows", image.getHeight() - last - 1);
    }
}
