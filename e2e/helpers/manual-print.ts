import { expect, type Page } from "@playwright/test";

// These workspace tests verify dispatch intent. QZ transport and rendering have
// their own isolated suite; a completed server job must never resend paper.
export async function mockCompletedManualPrint(page: Page) {
  const requests: { orderId: number; body: Record<string, unknown> }[] = [];
  const jobs = new Map<number, unknown>();
  await page.route(/\/api\/v1\/orders\/\d+\/printing$/, async (route) => {
    const orderId = Number(new URL(route.request().url()).pathname.split("/").at(-2));
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(route.request().headers()["idempotency-key"]).toBeTruthy();
      requests.push({ orderId, body });
      const job = { id: `manual-${requests.length}`, order_id: orderId, branch_id: 1,
        status: "printed", job_type: body.job_type, payload: { order: { folio: orderId } } };
      jobs.set(orderId, job);
      return route.fulfill({ status: 201, json: job });
    }
    return route.fulfill({ json: { order_id: orderId, items: jobs.has(orderId) ? [jobs.get(orderId)] : [], recoverable_error: false } });
  });
  return requests;
}
