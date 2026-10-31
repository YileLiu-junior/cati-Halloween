import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function resultPage(page, request, petType = "cat") {
  const quizVersion = `${petType}-2026v2`;
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
  const calls = { checkout: 0, confirm: 0, generate: 0, checks: 0, paid: false, roleId: null };
  const returnUrl = page.url();
  await page.route("**/api/refund-requests**", route => route.fulfill({ json: { request: null } }));
  await page.context().route("https://afdian.com/order/create?**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<html lang="zh-CN"><meta charset="utf-8"><h1>型号1付款页（测试替身）</h1><a href="${returnUrl}">返回 PETI（测试）</a></html>` }));
  await page.route("**/api/config", (route) => route.fulfill({ json: { amountFen: 180, available: true } }));
  await page.route("**/api/photos", (route) => route.fulfill({ status: 201, json: { photoId: "test-photo", expiresAt: order.expiresAt } }));
  await page.route("**/api/checkout**", (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/confirm")) {
      calls.confirm++;
      return route.fulfill({ status: mismatch ? 409 : 200, json: mismatch ? { message: "订单金额、商品或留言未匹配，请勿补付，联系作者核对" } : { ...order, status: "unlocked" } });
    }
    const current = resumed || (calls.checkout ? { ...order, roleId: calls.roleId, status: calls.paid ? "ready" : "unpaid", imageUrl: calls.paid ? "/api/jobs/test-order/image" : null } : null);
    if (request.method() === "GET") {
      if (path !== "/api/checkout") calls.checks++;
      return route.fulfill({ json: path === "/api/checkout" ? { order: current } : current });
    }
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
  await page.route("**/api/config", route => route.fulfill({ json: { available: false, amountFen: 180 } }));
  await page.route("**/api/checkout", route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { message: "支付尚未开放，暂不收款" } })
    : route.continue());
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
  await expect(page.locator("#generatePaidBtn")).toBeDisabled();
  await expect(page.locator("#customAvailability")).toBeVisible();
  await expect(page.locator("#paymentStep")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("#customBtn")).toBeFocused();
});
test("独立测试模式明确标注模拟订单，隐藏真实付款入口", async ({page,request})=>{
  await resultPage(page,request);await mockFlow(page);
  await page.route("**/api/config",route=>route.fulfill({json:{available:true,amountFen:180,testMode:true}}));
  await uploadPhoto(page);await expect(page.locator("#generatePaidBtn")).toContainText("测试订单");await page.locator("#generatePaidBtn").click();
  await expect(page.locator("#paymentAmount")).toContainText("无需真实付款");await expect(page.locator("#payLink")).toBeHidden();await expect(page.locator("#paymentInstructions")).toContainText("不发生真实收款");
});

test("照片上传超过30秒仍等待完成，不因普通查询限时取消", async ({ page, request }) => {
  test.setTimeout(75000);
  await resultPage(page, request); await mockFlow(page);
  await page.route("**/api/photos", async route => {
    await new Promise(resolve => setTimeout(resolve, 35000));
    await route.fulfill({ status: 201, json: { photoId: "test-photo", expiresAt: order.expiresAt } }).catch(() => {});
  });
  await page.locator("#customBtn").click(); await page.locator("#useResultRole").click();
  await selectPhoto(page); await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#uploadPhotoBtn")).toBeDisabled();
  await expect(page.locator("#generatePaidBtn")).toBeVisible({ timeout: 45000 });
  await expect(page.locator("#customError")).toBeHidden();
  await expect(page.locator("#photoHelp")).toContainText("上传完成");
});

for (const [networkError, message] of [["timedout", "照片上传超时"], ["internetdisconnected", "网络连接中断"]]) {
test(`上传${networkError}显示明确提示，保留预览并允许直接重试`, async ({ page, request }) => {
  await resultPage(page, request); await mockFlow(page);
  let attempts = 0;
  await page.route("**/api/photos", route => ++attempts === 1
    ? route.abort(networkError)
    : route.fulfill({ status: 201, json: { photoId: "test-photo", expiresAt: order.expiresAt } }));
  await page.locator("#customBtn").click(); await page.locator("#useResultRole").click();
  await selectPhoto(page); await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#customError")).toContainText(message);
  await expect(page.locator("#photoPreview")).toBeVisible();
  await expect(page.locator("#uploadPhotoBtn")).toBeEnabled();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#generatePaidBtn")).toBeVisible();
  await expect(page.locator("#customError")).toBeHidden();
  expect(attempts).toBe(2);
});
}
test("新标签页付款保留PETI，后台交付后切回领取，无需手工核单", async ({ page, request }) => {
  await resultPage(page, request);
  const calls = await mockFlow(page);
  await uploadPhoto(page);
  await page.locator("#generatePaidBtn").click();
  await expect(page.locator("#paymentStep")).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await page.locator("#payLink").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(PAY_URL);
  const target = new URL(popup.url());
  expect(JSON.parse(target.searchParams.get("sku"))).toEqual([{ sku_id: "231df344d2e911f1b46452540025c377", count: 1 }]);
  expect(target.searchParams.get("remark")).toBe("test-order");
  expect(calls.generate).toBe(0);
  calls.paid = true;
  await popup.close();
  await page.locator("#checkPaymentBtn").click();
  await expect(page.locator("#customImage")).toBeVisible();
  expect(calls.checkout).toBe(1); expect(calls.confirm).toBe(0); expect(calls.generate).toBe(0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#saveCustomBtn").click()]);
  expect(download.suggestedFilename()).toBe("PETI-馒头-万圣节头像.png");
});

test("未付款订单自动和手动查单后仍可直接跳转对应型号付款", async ({ page, request }) => {
  await resultPage(page, request);
  const calls = await mockFlow(page);
  await page.clock.install();
  await uploadPhoto(page);
  await page.locator("#generatePaidBtn").click();
  await expect(page.locator("#payLink")).toHaveAttribute("href", PAY_URL);
  for (let i = 1; i <= 2; i++) {
    await page.clock.fastForward(5000);
    await expect.poll(() => calls.checks).toBe(i);
    await expect(page.locator("#checkPaymentBtn")).toBeEnabled();
    await expect(page.locator("#payLink")).toBeVisible();
    await expect(page.locator("#customProgress")).toHaveText("");
  }
  await page.locator("#checkPaymentBtn").click();
  await expect.poll(() => calls.checks).toBe(3);
  await expect(page.locator("#checkPaymentBtn")).toBeEnabled();
  await expect(page.locator("#payLink")).toBeVisible();
  await expect(page.locator("#payLink")).toHaveAttribute("href", PAY_URL);
  expect(calls.checkout).toBe(1);
  expect(calls.generate).toBe(0);
  const popupPromise = page.waitForEvent("popup");
  await page.locator("#payLink").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(PAY_URL);
});
test("付款未匹配停在付款页；受理不明不提供再次生成", async ({ page, request }) => {
  await resultPage(page, request);
  const calls = await mockFlow(page, { mismatch: true });
  await uploadPhoto(page);
  await page.locator("#generatePaidBtn").click();
  const popupPromise = page.waitForEvent("popup");
  await page.locator("#payLink").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(PAY_URL);
  await popup.close();
  await page.locator("#checkPaymentBtn").click();
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
  await expect(page.locator("#customBtn")).toContainText("定制宠物万圣节装扮头像");
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
    await expect(page.locator("#browseRoleImage")).toHaveAttribute("src", "/role-thumbnails/20261030-v2/cat/atlas.webp");
    await expect(page.locator("#browseRoleImage")).toHaveAttribute("alt", roles[i].name);
    expect(await page.locator("#browseRoleImage").evaluate(img => img.style.transform)).toBe(`translate(${-25 * (i % 4)}%, ${-25 * Math.floor(i / 4)}%)`);
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

test("慢网核单和预览失败均不会锁住角色选择", async ({ page, request }) => {
  await resultPage(page, request);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/config", async route => { await gate; await route.fulfill({ json: { available: false, amountFen: 180 } }); });
  await page.route("**/role-thumbnails/**", route => route.abort());
  await page.locator("#customBtn").click();
  await expect(page.locator("#browseRoles")).toBeEnabled();
  await page.locator("#browseRoles").click();
  await expect(page.locator("#chooseRole")).toBeEnabled();
  await page.locator("#chooseRole").click();
  await expect(page.locator("#photoStep")).toBeVisible();
  release();
});

test("手机上照片选择使用独立按钮，纵向滑动不会关闭定制窗口", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await resultPage(page, request); await mockFlow(page);
  await page.locator("#customBtn").click(); await page.locator("#useResultRole").click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#pickPhotoBtn").click();
  await (await chooserPromise).setFiles([]);
  await selectPhoto(page);
  await page.locator("#customDialog").evaluate(dialog => { dialog.scrollTop = 100; });
  await expect(page.locator("#customDialog")).toBeVisible();
  await expect(page.locator("#photoPreview")).toBeVisible();
  const input = await page.locator("#petPhoto").boundingBox();
  expect(input.width).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("mobile-photo-stable.png") });
});

test("静态结果页不加载全息渲染或申请感应权限", async ({ page, request }) => {
  const urls = [];
  page.on("request", request => urls.push(request.url()));
  await page.addInitScript(() => {
    window.__motionRequests = 0;
    if (window.DeviceOrientationEvent) window.DeviceOrientationEvent.requestPermission = async () => { window.__motionRequests++; return "granted"; };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await resultPage(page, request);
  await expect(page.locator("#saveCardBtn")).toBeEnabled();
  await expect(page.locator("iframe, #motionBtn")).toHaveCount(0);
  expect(await page.evaluate(() => window.__motionRequests)).toBe(0);
  expect(urls.some(url => url.includes("/holo-card/") || url.includes("card-motion.js"))).toBe(false);
  await page.screenshot({ path: "shots/mobile-static-result-20261030.png", fullPage: true });
});

test("角色图集加载后快速切换不发新图片请求，也不隐藏图片", async ({ page, request }) => {
  const images = [];
  page.on("request", req => { if (req.url().includes("/role-thumbnails/")) images.push(req.url()); });
  await resultPage(page, request);
  await mockFlow(page);
  await page.locator("#customBtn").click(); await page.locator("#browseRoles").click();
  await expect.poll(() => page.locator("#browseRoleImage").evaluate(img => img.complete && img.naturalWidth)).toBe(1280);
  while (await page.locator("#previousRole").isEnabled()) await page.locator("#previousRole").click();
  const frames = await page.evaluate(async () => {
    const durations = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      document.getElementById("nextRole").click();
      await new Promise(requestAnimationFrame);
      const image = document.getElementById("browseRoleImage");
      if (image.classList.contains("hidden") || !image.complete) throw Error("Image disappeared while switching");
      durations.push(performance.now() - start);
    }
    return durations;
  });
  expect(images).toHaveLength(1);
  expect(Math.max(...frames)).toBeLessThan(100);
  await expect(page.locator("#roleCount")).toHaveText("16 / 16");
});


test("狗结果与选角图集只使用狗素材", async ({page, request}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seen = [];
  page.on("request", req => { if (/\/(static-cards|role-thumbnails)\//.test(new URL(req.url()).pathname)) seen.push(new URL(req.url()).pathname); });
  await resultPage(page, request, "dog"); await mockFlow(page);
  await expect(page.locator("#roleCardImage")).toHaveJSProperty("naturalWidth", 900);
  await page.screenshot({ path: ".wrangler/dog-result-pet-assets.png", fullPage: true });
  await expect(page.locator("#roleCardImage")).toHaveAttribute("src", /\/static-cards\/20261030-v2\/dog\//);
  await page.locator("#customBtn").click(); await page.locator("#browseRoles").click();
  await expect(page.locator("#browseRoleImage")).toHaveAttribute("src", "/role-thumbnails/20261030-v2/dog/atlas.webp");
  await expect.poll(() => page.locator("#browseRoleImage").evaluate(img => img.naturalWidth)).toBe(1280);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every(path => path.includes("/dog/"))).toBe(true);
  await page.screenshot({ path: ".wrangler/dog-role-selection-pet-assets.png", fullPage: true });
});
