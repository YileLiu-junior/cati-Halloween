import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function resultPage(page, request) {
  const session = await (await request.post("/api/sessions", { data: { petType: "cat", quizVersion: "cat-2026v1", source: "custom-test" } })).json();
  const result = await (await request.post("/api/results", { data: { ...session, petName: "馒头", optionIds: Array.from({ length: 10 }, (_, i) => `q${i + 1}a`) } })).json();
  await page.goto("/");
  await page.evaluate((state) => localStorage.setItem("peti:v1", JSON.stringify(state)), { ...session, result, petName: "馒头", petType: "cat", quizVersion: "cat-2026v1" });
  await page.goto("/result.html");
  await expect(page.locator("#customBtn")).toBeVisible();
}
async function selectPhoto(page, size = 600) {
  const base64 = await page.evaluate((edge) => {
    const canvas = document.createElement("canvas"); canvas.width = edge; canvas.height = edge;
    const context = canvas.getContext("2d"); context.fillStyle = "#999988"; context.fillRect(0, 0, edge, edge);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  }, size);
  await page.locator("#petPhoto").setInputFiles({ name: "pet.jpg", mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") });
}
const PAY_URL = "https://afdian.com/order/create?product_type=1&plan_id=2315e4b0d2e911f186f652540025c377&sku=%5B%7B%22sku_id%22%3A%22231df344d2e911f1b46452540025c377%22,%22count%22%3A1%7D%5D&viokrz_ex=0&remark=test-order";
const order = { payId: "test-order", jobId: "test-order", photoId: "test-photo", status: "unpaid", amountFen: 180, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), imageUrl: null };
async function mockFlow(page, { resumed = null, mismatch = false, uncertain = false } = {}) {
  const calls = { checkout: 0, confirm: 0, generate: 0, paid: false };
  const returnUrl = page.url();
  await page.route("https://afdian.com/order/create?**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<html lang="zh-CN"><meta charset="utf-8"><h1>型号1付款页（测试替身）</h1><a href="${returnUrl}">返回 PETI（测试）</a></html>` }));
  await page.route("**/api/config", (route) => route.fulfill({ json: { amountFen: 180, available: true } }));
  await page.route("**/api/photos", (route) => route.fulfill({ status: 201, json: { photoId: "test-photo", expiresAt: order.expiresAt } }));
  await page.route("**/api/checkout**", (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/confirm")) {
      calls.confirm++;
      return route.fulfill({ status: mismatch ? 409 : 200, json: mismatch ? { message: "订单金额、商品或留言未匹配，请勿补付，联系作者核对" } : { ...order, status: "unlocked" } });
    }
    const current = resumed || (calls.checkout ? { ...order, status: calls.paid ? "unlocked" : "unpaid" } : null);
    if (request.method() === "GET") return route.fulfill({ json: path === "/api/checkout" ? { order: current } : current });
    calls.checkout++;
    return route.fulfill({ json: { ...order, payUrl: PAY_URL } });
  });
  await page.route("**/api/jobs", (route) => {
    calls.generate++;
    return route.fulfill({ json: { ...order, status: uncertain ? "uncertain" : "ready", imageUrl: "/api/jobs/test-order/image" } });
  });
  await page.route("**/api/jobs/test-order/image", async (route) => route.fulfill({ contentType: "image/png", body: await readFile(new URL("../public/assets/illus-nurse.png", import.meta.url)) }));
  return calls;
}
async function uploadPhoto(page) {
  await page.locator("#customBtn").click();
  await selectPhoto(page);
  await page.locator("#photoConsent").check();
  await expect(page.locator("#uploadPhotoBtn")).toBeEnabled();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#generatePaidBtn")).toBeVisible();
}

test("真实上传先征得同意，上传完成显示 1.8 元入口，空配置阻止收费", async ({ page, request }) => {
  await resultPage(page, request);
  await page.locator("#customBtn").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#photoConsent")).not.toBeChecked();
  await expect(page.locator("#generatePaidBtn")).toBeHidden();
  await selectPhoto(page);
  await expect(page.locator("#photoPreview")).toBeVisible();
  await expect(page.locator("#uploadPhotoBtn")).toBeDisabled();
  await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#generatePaidBtn")).toHaveText("1.8元生成定制盲盒");
  await expect(page.locator("#photoHelp")).toContainText("上传完成");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#customDialog").screenshot({ path: "shots/custom-upload.png" });
  await page.locator("#generatePaidBtn").click();
  await expect(page.locator("#customError")).toContainText("暂不收款");
  await expect(page.locator("#paymentStep")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("#customBtn")).toBeFocused();
});
test("直接进入指定型号付款页，到账后返回自动生成，无需手工核单", async ({ page, request }) => {
  await resultPage(page, request);
  const calls = await mockFlow(page);
  await uploadPhoto(page);
  await page.locator("#generatePaidBtn").click();
  await expect(page).toHaveURL(PAY_URL);
  const target = new URL(page.url());
  expect(JSON.parse(target.searchParams.get("sku"))).toEqual([{ sku_id: "231df344d2e911f1b46452540025c377", count: 1 }]);
  expect(target.searchParams.get("remark")).toBe("test-order");
  expect(calls.generate).toBe(0);
  calls.paid = true;
  await page.getByRole("link", { name: "返回 PETI（测试）" }).click();
  await expect(page.locator("#customImage")).toBeVisible();
  expect(calls.checkout).toBe(1); expect(calls.confirm).toBe(0); expect(calls.generate).toBe(1);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#saveCustomBtn").click()]);
  expect(download.suggestedFilename()).toBe("喵灵万圣节-馒头-定制盲盒.png");
});
test("付款未匹配停在付款页；受理不明不提供再次生成", async ({ page, request }) => {
  await resultPage(page, request);
  const calls = await mockFlow(page, { mismatch: true });
  await uploadPhoto(page);
  await page.locator("#generatePaidBtn").click();
  await expect(page).toHaveURL(PAY_URL);
  await page.getByRole("link", { name: "返回 PETI（测试）" }).click();
  await expect(page.locator("#paymentStep")).toBeVisible();
  await page.getByText("付款后仍未确认？", { exact: true }).click();
  await page.locator("#platformOrderNo").fill("2026102800000001");
  await page.locator("#confirmPaymentBtn").click();
  await expect(page.locator("#customError")).toContainText("请勿补付");
  await expect(page.locator("#paymentStep")).toBeVisible();
  expect(calls.generate).toBe(0);
  await page.locator("#closeCustomBtn").click();
  await page.unrouteAll();
  await mockFlow(page, { resumed: { ...order, status: "uncertain" } });
  await page.locator("#customBtn").click();
  await expect(page.locator("#generationMessage")).toContainText("结果暂未确认");
  await expect(page.locator("#retryJobBtn")).toBeHidden();
});
test("小照片提示换图，320 与 390px 弹框不溢出，已交付订单可重新读取", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFlow(page);
  await page.locator("#customBtn").click();
  await selectPhoto(page, 128);
  await expect(page.locator("#customError")).toContainText("至少 512px");
  await expect(page.locator("#uploadPhotoBtn")).toBeDisabled();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator("#customDialog").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.locator("#closeCustomBtn").click();
  await page.unrouteAll();
  const calls = await mockFlow(page, { resumed: { ...order, status: "ready", imageUrl: "/api/jobs/test-order/image" } });
  await page.locator("#customBtn").click();
  await expect(page.locator("#customImage")).toBeVisible();
  expect(calls.generate).toBe(0);
});
