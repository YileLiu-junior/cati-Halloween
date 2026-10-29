import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function resultPage(page, request, petType = "cat") {
  const quizVersion = `${petType}-2026v1`;
  const session = await (await request.post("/api/sessions", { data: { petType, quizVersion, source: "custom-test" } })).json();
  const result = await (await request.post("/api/results", { data: { ...session, petName: "馒头", optionIds: Array.from({ length: 10 }, (_, i) => `q${i + 1}a`) } })).json();
  await page.goto("/");
  await page.evaluate((state) => localStorage.setItem("peti:v1", JSON.stringify(state)), { ...session, result, petName: "馒头", petType, quizVersion });
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
  const calls = { checkout: 0, confirm: 0, generate: 0, paid: false, roleId: null };
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
    const current = resumed || (calls.checkout ? { ...order, roleId: calls.roleId, status: calls.paid ? "unlocked" : "unpaid" } : null);
    if (request.method() === "GET") return route.fulfill({ json: path === "/api/checkout" ? { order: current } : current });
    calls.checkout++;
    calls.roleId = request.postDataJSON().roleId;
    return route.fulfill({ json: { ...order, roleId: calls.roleId, payUrl: PAY_URL } });
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
  await page.locator("#useResultRole").click();
  await selectPhoto(page);
  await page.locator("#photoConsent").check();
  await expect(page.locator("#uploadPhotoBtn")).toBeEnabled();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#generatePaidBtn")).toBeVisible();
}

test("真实上传先征得同意，上传完成可确认付款，空配置阻止收费", async ({ page, request }, testInfo) => {
  await resultPage(page, request);
  await page.locator("#customBtn").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator("#useResultRole").click();
  await expect(page.locator("#photoConsent")).not.toBeChecked();
  await expect(page.locator("#generatePaidBtn")).toBeHidden();
  await selectPhoto(page);
  await expect(page.locator("#photoPreview")).toBeVisible();
  await expect(page.locator("#uploadPhotoBtn")).toBeDisabled();
  await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#generatePaidBtn")).toHaveText("下一步：确认付款");
  await expect(page.locator("#photoHelp")).toContainText("上传完成");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#customDialog").screenshot({ path: testInfo.outputPath("custom-upload.png") });
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
  await expect(page.locator("#paymentStep")).toBeVisible();
  await page.locator("#payLink").click();
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
  await page.locator("#payLink").click();
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
  await page.locator("#useResultRole").click();
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
test("选择其它角色可逐张查看 16 个参考图，并将选择带入付款", async ({ page, request }) => {
  await resultPage(page, request);
  const calls = await mockFlow(page);
  const roles = (await (await request.get("/data/quiz-cat.json")).json()).characters;
  await page.locator("#customBtn").click();
  await expect(page.locator("#customBtn")).toContainText("生成专属盲盒角色卡片");
  await page.locator("#browseRoles").click();
  while (await page.locator("#previousRole").isEnabled()) await page.locator("#previousRole").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator("#browseRoleImage").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.locator("#customDialog").screenshot({ path: "shots/custom-role-selection.png" });
  const swipe = async (from, to) => page.locator("#roleSlide").evaluate((el, [start, end]) => {
    for (const [type, x] of [["touchstart", start], ["touchend", end]]) {
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: 100 })] }));
    }
  }, [from, to]);
  await swipe(250, 100);
  await expect(page.locator("#roleCount")).toHaveText("2 / 16");
  await swipe(100, 250);
  await expect(page.locator("#roleCount")).toHaveText("1 / 16");
  for (let i = 0; i < roles.length; i++) {
    await expect(page.locator("#browseRoleName")).toHaveText(roles[i].name);
    await expect(page.locator("#browseRoleQuote")).toContainText(roles[i].quote);
    await expect(page.locator("#browseRarity")).toContainText(String(roles[i].rarityPct));
    await expect(page.locator("#browseRoleImage")).toHaveAttribute("src", `/role-references/${roles[i].id}.png`);
    expect((await request.head(`/role-references/${roles[i].id}.png`)).ok()).toBe(true);
    await expect(page.locator("#roleCount")).toHaveText(`${i + 1} / 16`);
    if (i < roles.length - 1) await page.locator("#nextRole").click();
  }
  await page.locator("#chooseRole").click();
  await expect(page.locator("#selectedRoleName")).toHaveText(roles.at(-1).name);
  await selectPhoto(page);
  await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await page.locator("#generatePaidBtn").click();
  await expect(page.locator("#paymentRoleName")).toHaveText(roles.at(-1).name);
  expect(calls.roleId).toBe(roles.at(-1).id);
});
test("狗狗测评使用狗狗角色文案，恢复订单保留之前选择的角色", async ({ page, request }) => {
  await resultPage(page, request, "dog");
  const roles = (await (await request.get("/data/quiz-dog.json")).json()).characters;
  const chosen = roles.find((role) => role.id === "ghost");
  const calls = await mockFlow(page, { resumed: { ...order, roleId: chosen.id } });
  await page.locator("#customBtn").click();
  await expect(page.locator("#paymentRoleName")).toHaveText(chosen.name);
  expect(calls.roleId).toBe(chosen.id);
});
