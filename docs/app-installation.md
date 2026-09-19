# Instalar Escalar AI POS

## Uso

1. Abre el POS e inicia sesion con tu acceso habitual.
2. Pulsa **Instalar app** arriba a la derecha. Abre `/descargar-app` en la misma pestana.
3. Cuando este disponible, pulsa **Instalar Escalar AI POS** y confirma el dialogo del navegador.
4. El navegador permite abrirla en una ventana independiente. Inicio, escritorio y barra de tareas son opciones del navegador/sistema y del usuario.

Si el boton esta deshabilitado, sigue la guia mostrada para el navegador. Edge y
Chrome tambien ofrecen instalacion desde su menu o barra de direcciones. En
iPhone/iPad, Safari permite Compartir > Anadir a pantalla de inicio (activar Abrir
como app web cuando aparezca). En Safari para Mac compatible, usar Archivo >
Anadir al Dock. Un navegador integrado puede requerir abrir la direccion en un
navegador normal. No se imitan los dialogos nativos ni se garantiza que todos los
navegadores ofrezcan el mismo control.

Cancelar no cierra la sesion ni cambia ajustes. Cada evento del navegador se puede
usar una sola vez: despues de cancelarlo o de un error, se necesita una nueva
oferta del navegador o instalar desde su menu. Aceptar no equivale a finalizar:
solo `appinstalled` o ejecutar en modo independiente confirma el resultado. No
se guarda una bandera de instalacion en localStorage.

## Alcance y seguridad

- Es una PWA **conectada**, no un instalador `.exe` ni una aplicacion de tienda.
- No incluye service worker, cache offline, pedidos sin conexion ni sincronizacion.
- No altera cuentas, permisos, sucursales, pagos o autenticacion. Instalar no vincula
  el dispositivo con PIN. Si no comparte sesion, solicita el inicio normal.
- Es exactamente el mismo CLIENTES que la web, no una version reducida ni otra
  base de datos. Conserva sus funciones y llamadas a la misma API. Los contratos
  de integracion para el agente de WhatsApp siguen intactos; n8n no se modifica.
- No actualiza ni recarga forzosamente una operacion. QZ Tray sigue siendo una
  instalacion independiente para imprimir desde la computadora.
- La identidad instalada es siempre Escalar AI POS, no la de un restaurante.
  La seleccion de negocio/sucursal sigue perteneciendo a la sesion.
- El acceso superior esta disponible para cualquier miembro autenticado; no hay
  controles nuevos de instalacion, Soporte o Tutoriales en la carta publica.

## Desarrollo y activacion

La instalacion desde `http://127.0.0.1:5173` o localhost sirve solo para este
equipo. **CLIENTES y la API deben seguir encendidos**. Instalar la app no los
descarga, no los inicia y no crea servicios de arranque.

Para otros equipos se necesita un dominio HTTPS accesible y la configuracion
normal de produccion de POS/API (incluyendo origenes y cookies seguros cuando
corresponda). Una IP privada HTTP no sustituye HTTPS. No publicar tokens de
desarrollo ni habilitar autenticacion de desarrollo en builds. No hay despliegue
ni cambios a la API en esta entrega.

El manifiesto publico `/manifest.webmanifest` tiene `id`, `start_url` y `scope`
iguales a `/`, `display: standalone`, idioma `es`, nombre Escalar AI POS y nombre
corto Escalar POS. Mantener esta identidad para evitar duplicar instalaciones.
Los enlaces de manifest/iconos son absolutos para funcionar en rutas profundas.
Vercel conserva el rewrite SPA y el MIME del manifiesto; los archivos estaticos
existentes se sirven como archivos, no como HTML del POS.

Los iconos de tienda reutilizan la geometria Lucide y el verde del POS; su licencia
esta incluida en `public/icons/icon.svg`. No contienen imagenes de un restaurante ni
marcas de las referencias. PNG 192/512, variante maskable 512 y Apple 180:

```powershell
node scripts/generate-app-icons.mjs
node scripts/verify-pwa-build.mjs --source
npm run build
npm run preview -- --host 127.0.0.1 --port 5176 --strictPort
# En otra terminal, con el preview encendido:
node scripts/verify-pwa-build.mjs --url http://127.0.0.1:5176
```

El verificador solo hace GET anonimos de recursos estaticos y rutas SPA. No inicia
sesion, no llama a la API y no ejecuta scripts del POS. El preview de produccion
no admite los tokens de autenticacion reservados al desarrollo.

## Verificacion de esta entrega

- Lint, Vitest (684 pruebas) y build ejecutados. Pruebas aisladas de eventos tempranos, una sola
  solicitud, cancelacion, errores, eventos consumidos, navegacion, modo independiente
  y confirmacion tardia sin sobrescribir exito.
- El usuario confirmo el 2026-09-12 la instalacion real en Edge/Windows, apertura
  en ventana propia, icono de tienda y sesion conservada. La captura muestra el
  mensaje confirmado y el navegador ofreciendo anclar la app.
- El usuario tambien confirmo que la sesion se conserva al cerrar y volver a abrir
  la app desde el acceso instalado. Se verificaron Pedidos e Inicio en esa ventana
  reabierta, sin modificar datos ni enviar impresiones.
- El build servido con Vite Preview respondio correctamente con el manifiesto,
  los cuatro PNG, SVG, raiz y 14 rutas profundas, incluyendo `/descargar-app`.
- Playwright: 78/78 recorridos aislados aprobados en escritorio, tablet y movil,
  mas 6/6 en la comprobacion final tras ajustes visuales. Incluyen cuatro roles,
  navegacion/foco, estados simulados, guias por plataforma y acceso publico sin CTA.
- Revision visual agrupada de disponible, instalado y guia alternativa en los tres
  tamanos, mas 1144 px. Detector Impeccable ejecutado una vez: cuatro avisos de
  escala tipografica/radio corregidos para reutilizar la escala existente.
- La revision independiente pidio mejorar el contraste del mensaje de exito;
  corregido con el verde oscuro existente (5.39:1) y otros 6/6 recorridos finales.
  Su comprobacion posterior dio `ship`, sin hallazgos pendientes en ese alcance.
- El build conserva el aviso ya existente de chunk principal mayor a 500 kB.
- Dispositivos iPhone/iPad, Android y Safari Mac fisicos: no probados. Los recorridos
  responsive/simulados no sustituyen la instalacion fisica en esos sistemas.

## Impresion en la app

Para evitar avisos de QZ por pedido, cada equipo/usuario de impresion requiere
la activacion unica del certificado propio desde Configuracion > Impresion.
Instalar la PWA no registra certificados ni distribuye claves privadas. Sigue
la [guia de impresion](printing-activation.md#activacion-unica-de-confianza).
La app instalada y la web usan el mismo firmador y conservan los mismos permisos.

## Referencias oficiales

- [Microsoft: crear una PWA](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/): instalacion en Edge, contexto seguro y service worker opcional.
- [Chrome: criterios de instalacion](https://web.dev/articles/install-criteria): manifiesto, iconos, contexto seguro y criterios de interaccion del navegador.
- [Apple: abrir como app web en iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios): agregar al inicio y confirmar como app web.
- [WebKit: Safari 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/): comportamiento de apps web en los sistemas Apple.
# Public test address (2026-09-19)

The personal/noncommercial test deployment is `https://pos.escalarai.tech`.
It uses `https://api.escalarai.tech/api/v1` and the recovered Supabase project.
The localhost installation does not move automatically: open the HTTPS address
and install that application separately. Sign in with the normal restaurant
credentials; installing does not change permissions or link a PIN device.

Manifest, icons, deep links and the installation page were verified on the served
Vercel build in desktop/tablet/mobile browser viewports. Physical mobile
installation and physical printing from this domain remain pending. Render Free
may sleep; the application still requires a working connection and awake API.
See `Apis/docs/deployment-runbook.md` in the workspace for release evidence,
security follow-ups and commercial activation requirements.
