import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const TIP_URL = "https://afdian.com/order/create?product_type=1&plan_id=2315e4b0d2e911f186f652540025c377&sku=%5B%7B%22sku_id%22%3A%22231df344d2e911f1b46452540025c377%22,%22count%22%3A1%7D%5D&viokrz_ex=0";
const IMAGE_PATH = "/api/jobs/test-order/image";
const EXPIRES = new Date(Date.now() + 7 * 86_400_000).toISOString();

async function resultPage(page, request, petType = "cat") {
  const quizVersion = `${petType}-2026v4`;
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
function quota(patch = {}) {
  return { enabled: true, total: 1000, used: 12, remaining: 988, perBrowser: 2, browserUsed: 0, browserRemaining: 2, exhausted: false, browserExhausted: false, reason: null, ...patch };
}
function serviceConfig(patch = {}) {
  return { serverNow: new Date().toISOString(), testMode: false, available: true, paymentAvailable: false, tipUrl: TIP_URL, free: quota(), ...patch };
}
function freeOrder(patch = {}) {
  return {
    orderId: "test-order", payId: "test-order", jobId: "test-order", photoId: "test-photo",
    status: "unlocked", amountFen: 0, free: true, roleId: "ghost", petType: "cat",
    petName: "馒头", roleName: "幽灵", paidAt: null, deliveredAt: null,
    refundStatus: "none", primaryRefunded: false, refundEligible: false,
    retryable: false, errorCode: null, imageUrl: null, expiresAt: EXPIRES,
    attemptId: "test-attempt", ...patch,
  };
}
function feedbackPayload(patch = {}) {
  return {
    attemptId: "test-attempt", testId: "test", orderId: "test-order",
    satisfied: true, satisfaction: 3, similarity: null, issue: null, priceBand: null, spendHistory: null,
    priceFen: null, priceAnswered: false, skipped: false, petType: "cat", roleId: "ghost", updatedAt: Date.now(), ...patch,
  };
}
async function mockFreeFlow(page, options = {}) {
  const calls = { posts: [], feedbacks: [], gets: 0 };
  const state = {
    config: options.config || serviceConfig(),
    free: options.free || quota(),
    order: options.order ?? null,
    feedback: options.feedback ?? null,
    post: options.post || { order: freeOrder(), free: quota(), feedback: null, idempotent: false },
    postStatus: options.postStatus ?? 202,
    onPost: options.onPost || null,
    onFeedback: options.onFeedback || null,
    onGet: options.onGet || null,
  };
  await page.route("**/api/config**", route => route.fulfill({ json: state.config }));
  await page.route("**/api/photos", route => route.fulfill({ status: 201, json: { photoId: "test-photo", expiresAt: EXPIRES } }));
  await page.route("**/api/free-orders**", async route => {
    const request = route.request();
    if (request.method() === "GET") {
      calls.gets++;
      const order = state.onGet ? state.onGet(calls) : state.order;
      return route.fulfill({ json: { order, feedback: state.feedback, free: state.free } });
    }
    const body = request.postDataJSON();
    calls.posts.push(body);
    if (state.onPost) {
      const result = await state.onPost(body, state);
      return route.fulfill({ status: result.status ?? 202, json: result.body });
    }
    const response = state.post;
    if (response.order) state.order = response.order;
    if (response.free) state.free = response.free;
    if (response.feedback !== undefined) state.feedback = response.feedback;
    return route.fulfill({ status: state.postStatus, json: response });
  });
  await page.route("**/api/feedback", route => {
    const body = route.request().postDataJSON();
    calls.feedbacks.push(body);
    const response = state.onFeedback ? state.onFeedback(body) : feedbackPayload();
    state.feedback = response;
    return route.fulfill({ json: { feedback: response } });
  });
  await page.route(`**${IMAGE_PATH}`, async route => route.fulfill({ contentType: "image/png", body: await readFile(new URL("../public/assets/illus-nurse.png", import.meta.url)) }));
  return { calls, state };
}
async function uploadPhoto(page) {
  await page.locator("#customBtn").click();
  await page.locator("#useResultRole").click();
  await selectPhoto(page);
  await page.locator("#photoConsent").check();
  await expect(page.locator("#uploadPhotoBtn")).toBeEnabled();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#startFreeBtn")).toBeVisible();
}
function answersFeedback(body) {
  const satisfaction = body.satisfaction ?? (body.satisfied ? 3 : 1);
  const satisfied = satisfaction >= 2;
  return feedbackPayload({
    satisfaction,
    satisfied,
    similarity: satisfied ? body.similarity ?? null : null,
    priceBand: satisfied ? body.priceBand ?? null : null,
    issue: satisfied ? null : body.issue ?? null,
    spendHistory: body.spendHistory ?? null,
    priceAnswered: satisfied && body.priceBand != null,
  });
}

test("免费弹窗内不存在付款与退款元素，步骤条为三步", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page);
  await page.locator("#customBtn").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#paymentStep, #refundSection, #payLink, #stepPayment, #copyPaymentBtn, #confirmPaymentBtn, #checkPaymentBtn")).toHaveCount(0);
  await expect(page.locator(".custom-steps li")).toHaveCount(3);
  await expect(page.locator("#stepRole")).toContainText("1 选择角色");
  await expect(page.locator("#stepPhoto")).toContainText("2 上传照片");
  await expect(page.locator("#stepGenerate")).toContainText("3 生成头像");
});

test("限时免费角标可展开说明，角标文案显示全站剩余份数", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page);
  await page.locator("#customBtn").click();
  const badge = page.locator("#freeQuotaBadge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("限时免费 · 剩 988 份");
  await expect(page.locator("#freeQuotaHelp")).toBeHidden();
  await badge.click();
  await expect(badge).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#freeQuotaHelp")).toBeVisible();
  await expect(page.locator("#freeQuotaHelp")).toContainText("每个浏览器最多 2 次，全站限量 1000 份");
  await badge.click();
  await expect(badge).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#freeQuotaHelp")).toBeHidden();
});

test("免费额度说明使用服务端配置的总额度", async ({ page, request }) => {
  await resultPage(page, request);
  const free = quota({ total: 10, used: 0, remaining: 10 });
  await mockFreeFlow(page, { config: serviceConfig({ free }), free });
  await page.locator("#customBtn").click();
  await expect(page.locator("#freeQuotaBadge")).toContainText("剩 10 份");
  await page.locator("#freeQuotaBadge").click();
  await expect(page.locator("#freeQuotaHelp")).toContainText("全站限量 10 份");
});

test("全局免费额度耗尽时角标关闭且生成按钮禁用", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page, { config: serviceConfig({ free: quota({ used: 1000, remaining: 0, exhausted: true, reason: "QUOTA_EXHAUSTED" }) }), free: quota({ used: 1000, remaining: 0, exhausted: true, reason: "QUOTA_EXHAUSTED" }) });
  await page.locator("#customBtn").click();
  await expect(page.locator("#freeQuotaBadge")).toContainText("免费通道已关闭");
  await expect(page.locator("#freeQuotaBadge")).toHaveAttribute("data-state", "closed");
  await page.locator("#useResultRole").click();
  await selectPhoto(page);
  await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#startFreeBtn")).toBeVisible();
  await expect(page.locator("#startFreeBtn")).toBeDisabled();
  await expect(page.locator("#freeQuotaNote")).toContainText("这轮 1000 份免费头像已经领完啦");
});

test("上传照片并同意后免费按钮可用，首次请求 regenerate=false", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page);
  await page.locator("#customBtn").click();
  await page.locator("#useResultRole").click();
  await selectPhoto(page);
  await expect(page.locator("#photoHelp")).toContainText("已处理为 600 × 600 像素");
  await expect(page.locator("#uploadPhotoBtn")).toBeDisabled();
  await page.locator("#photoConsent").check();
  await expect(page.locator("#uploadPhotoBtn")).toBeEnabled();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#startFreeBtn")).toBeVisible();
  await expect(page.locator("#startFreeBtn")).toBeEnabled();
  await expect(page.locator("#freeQuotaNote")).toContainText("这台浏览器还可以免费生成 2 次");
  await page.locator("#startFreeBtn").click();
  await expect.poll(() => flow.calls.posts.length).toBe(1);
  expect(flow.calls.posts[0]).toMatchObject({ testId: expect.any(String), photoId: "test-photo", roleId: expect.any(String), regenerate: false });
  expect(flow.calls.posts[0].browserId).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page.locator("#generationProgress")).toBeVisible();
  await expect(page.locator("#genStepRequest")).toHaveAttribute("data-state", "active");
  await expect(page.locator("#genStepWait")).toHaveAttribute("data-state", "pending");
});

test("1000 份用完后点击定制按钮只显示上限提示", async ({ page, request }) => {
  await page.route("**/api/config**", route => route.fulfill({ json: serviceConfig({ free: quota({ exhausted: true, remaining: 0, browserRemaining: 0 }) }) }));
  await resultPage(page, request);
  await page.waitForFunction(() => document.documentElement.dataset.service === "ready");
  await page.locator("#customBtn").click();
  await expect(page.locator("#quotaClosedDialog")).toBeVisible();
  await expect(page.locator("#quotaClosedTitle")).toHaveText("本次作者自费生图数量已达上限");
  await expect(page.locator("#quotaClosedBody")).toHaveText("期待下次能给您更好的体验");
  await expect(page.locator("#customDialog")).toBeHidden();
  await page.locator("#closeQuotaClosed").click();
  await expect(page.locator("#quotaClosedDialog")).toBeHidden();
});

test("额度用完但已经生成过头像时仍可进入定制弹窗查看", async ({ page, request }) => {
  const quizVersion = "cat-2026v4";
  const session = await (await request.post("/api/sessions", { data: { petType: "cat", quizVersion, source: "custom-test" } })).json();
  const result = await (await request.post("/api/results", { data: { ...session, petName: "馒头", optionIds: Array.from({ length: 10 }, (_, i) => `q${i + 1}a`) } })).json();
  const exhausted = serviceConfig({ free: quota({ exhausted: true, remaining: 0, browserRemaining: 0 }) });
  await page.route("**/api/config**", route => route.fulfill({ json: exhausted }));
  await page.goto("/");
  await page.evaluate((state) => localStorage.setItem("peti:v1", JSON.stringify(state)), {
    ...session, result, petName: "馒头", petType: "cat", quizVersion,
    generation: { orderId: "test-order", status: "ready", imageUrl: IMAGE_PATH },
  });
  await page.goto("/result.html");
  await page.waitForFunction(() => document.documentElement.dataset.service === "ready");
  await mockFreeFlow(page, { config: exhausted, order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }) });
  await page.locator("#customBtn").click();
  await expect(page.locator("#customDialog")).toBeVisible();
  await expect(page.locator("#quotaClosedDialog")).toBeHidden();
  await expect(page.locator("#customImage")).toBeVisible();
});

test("生成中每 5 秒轮询，ready 后显示头像并出现满意度问卷", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page);
  await page.clock.install();
  await uploadPhoto(page);
  await page.locator("#startFreeBtn").click();
  await expect(page.locator("#genStepRequest")).toHaveAttribute("data-state", "active");
  // 等首轮渲染完成并挂上 5 秒轮询，再推进时钟。
  await expect(page.locator("#generationProgress")).toBeVisible();
  await expect(page.getByRole("button", { name: "查询进度" })).toHaveCount(0);
  expect(flow.calls.gets).toBe(1);
  flow.state.order = freeOrder({ status: "ready", imageUrl: IMAGE_PATH });
  flow.state.free = quota({ used: 13, remaining: 987, browserUsed: 1, browserRemaining: 1 });
  await page.clock.fastForward(5000);
  await expect(page.locator("#customImage")).toBeVisible();
  await expect(page.locator("#saveCustomBtn")).toBeVisible();
  await expect(page.locator("#surveyStep")).toBeVisible();
  await expect(page.locator("#surveyHeading")).toBeFocused();
  await expect(page.locator('[data-satisfaction="3"]')).toBeVisible();
  await expect(page.locator('[data-satisfaction="1"]')).toBeVisible();
  // 保存直接得到 JPG 文件，不再打开新的 PNG 页面。
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#saveCustomBtn").click()]);
  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
  expect(bytes.length).toBeGreaterThan(10_000);
});

test("生成中切换到等待图片生成，完成后隐藏两步进度", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page, {
    post: { order: freeOrder({ status: "generating" }), free: quota(), feedback: null, idempotent: false },
  });
  await page.clock.install();
  await uploadPhoto(page);
  await page.locator("#startFreeBtn").click();
  // 先等生成请求真正返回，避免轮询计时器与响应竞速。
  await expect(page.locator("#genStepWait")).toHaveAttribute("data-state", "active");
  await expect(page.locator("#genStepRequest")).toHaveAttribute("data-state", "done");
  await expect(page.locator("#genStepWait")).toContainText("预计等待两分钟");
  await expect(page.locator("#generationLive")).toHaveText("正在等待图片生成");
  flow.state.order = freeOrder({ status: "ready", imageUrl: IMAGE_PATH });
  await page.clock.fastForward(5000);
  await expect(page.locator("#customImage")).toBeVisible();
  await expect(page.locator("#generationProgress")).toBeHidden();
});

test("头像加载前在成品位置显示方形加载占位", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }) });
  await page.unroute(`**${IMAGE_PATH}`);
  await page.route(`**${IMAGE_PATH}`, async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.fulfill({ contentType: "image/png", body: await readFile(new URL("../public/assets/illus-nurse.png", import.meta.url)) });
  });
  await page.locator("#customBtn").click();
  await expect(page.locator("#customImagePlaceholder")).toBeVisible();
  await expect(page.locator("#customImagePlaceholder")).toContainText("正在加载头像");
  await expect(page.locator("#customImage")).toBeHidden();
  await expect(page.locator("#customImage")).toBeVisible();
  await expect(page.locator("#customImagePlaceholder")).toBeHidden();
});

test("点击生成的头像打开大图查看器，保留长按保存与打开原图", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }) });
  await page.locator("#customBtn").click();
  await expect(page.locator("#customImage")).toBeVisible();
  await page.locator("#viewCustomLink").click();
  await expect(page.locator("#imageViewer")).toBeVisible();
  await expect(page.locator("#imageViewerTitle")).toHaveText("万圣节头像大图");
  await expect(page.locator("#viewerImage")).toHaveAttribute("src", /^blob:/);
  await expect(page.locator("#openOriginalImage")).toHaveAttribute("href", /^blob:/);
  await expect(page.locator(".viewer-note")).toContainText("长按图片可保存");
});

test("问卷四题按顺序展开，答案写进同一次记录", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }), onFeedback: answersFeedback });
  await page.locator("#customBtn").click();
  await expect(page.locator("#surveyStep")).toBeVisible();
  await expect(page.locator("#similarityQuestion")).toBeHidden();
  await page.locator('[data-satisfaction="3"]').click();
  await expect(page.locator("#similarityQuestion")).toBeVisible();
  await expect(page.locator("#priceQuestion")).toBeHidden();
  await page.locator('[data-similarity="3"]').click();
  await expect(page.locator("#priceQuestion")).toBeVisible();
  await expect(page.locator("#spendQuestion")).toBeHidden();
  await page.locator('[data-price-band="3-5"]').click();
  await expect(page.locator("#spendQuestion")).toBeVisible();
  await page.locator('[data-spend="2"]').click();
  await expect(page.locator("#surveyStatus")).toHaveText("已记录，谢谢你的反馈。");
  expect(flow.calls.feedbacks).toHaveLength(4);
  expect(flow.calls.feedbacks[0]).toMatchObject({ satisfaction: 3 });
  expect(flow.calls.feedbacks[3]).toMatchObject({ satisfaction: 3, similarity: 3, priceBand: "3-5", spendHistory: 2, issue: null });
});

test("不太满意改问哪里不对，跳过相似度和价格", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }), onFeedback: answersFeedback });
  await page.locator("#customBtn").click();
  await page.locator('[data-satisfaction="1"]').click();
  await expect(page.locator("#issueQuestion")).toBeVisible();
  await expect(page.locator("#issueHeading")).toBeFocused();
  await expect(page.locator("#similarityQuestion")).toBeHidden();
  await expect(page.locator("#priceQuestion")).toBeHidden();
  await page.locator('[data-issue="style"]').click();
  await expect(page.locator("#spendQuestion")).toBeVisible();
  await page.locator('[data-spend="1"]').click();
  await expect.poll(() => flow.calls.feedbacks.length).toBe(3);
  expect(flow.calls.feedbacks[2]).toMatchObject({ satisfaction: 1, issue: "style", similarity: null, priceBand: null, spendHistory: 1 });
});

test("换满意度会清掉另一条分支的答案", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }), onFeedback: answersFeedback });
  await page.locator("#customBtn").click();
  await page.locator('[data-satisfaction="3"]').click();
  await page.locator('[data-similarity="2"]').click();
  await page.locator('[data-price-band="6-10"]').click();
  await page.locator('[data-satisfaction="1"]').click();
  await expect(page.locator("#similarityQuestion")).toBeHidden();
  await expect(page.locator("#priceQuestion")).toBeHidden();
  await expect(page.locator("#issueQuestion")).toBeVisible();
  expect(flow.calls.feedbacks.at(-1)).toMatchObject({ satisfaction: 1, similarity: null, priceBand: null });
  await page.locator('[data-issue="detail"]').click();
  expect(flow.calls.feedbacks.at(-1)).toMatchObject({ satisfaction: 1, issue: "detail", similarity: null, priceBand: null });
});

test("打赏文案强调紫色下划线的“打赏”并跟随当前价格", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }), config: serviceConfig({ amountFen: 180 }) });
  await page.locator("#customBtn").click();
  const tip = page.locator("#tipAuthorLink");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("喜欢这种头像？花1.8元打赏作者");
  const style = await page.locator(".tip-action").evaluate(el => {
    const computed = getComputedStyle(el);
    return { color: computed.color, decoration: computed.textDecorationLine, thickness: computed.textDecorationThickness };
  });
  expect(style.decoration).toContain("underline");
  expect(style.color).toBe("oklch(0.82 0.12 316)");
});

test("手机保存头像走系统面板输出 JPG，不离开当前页面", async ({ browser, request }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      window.__sharedFiles = [];
      Object.defineProperty(navigator, "canShare", { configurable: true, value: (data) => Boolean(data?.files?.length) });
      Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => {
        window.__sharedFiles.push(...data.files.map(file => ({ name: file.name, type: file.type })));
      } });
    });
    await resultPage(page, request);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }) });
    const before = page.url();
    await page.locator("#customBtn").click();
    await expect(page.locator("#customImage")).toBeVisible();
    await page.locator("#saveCustomBtn").click();
    await expect.poll(() => page.evaluate(() => window.__sharedFiles.length)).toBe(1);
    const shared = await page.evaluate(() => window.__sharedFiles[0]);
    expect(shared.type).toBe("image/jpeg");
    expect(shared.name).toMatch(/\.jpg$/);
    expect(page.url()).toBe(before);
    await expect(page.locator("#saveCustomBtn")).toHaveText("已打开保存面板");
  } finally { await context.close(); }
});

test("不满意时换角色再试保留照片，回到角色步骤后再次生成 regenerate=true", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page, { onFeedback: answersFeedback });
  await page.clock.install();
  await uploadPhoto(page);
  await page.locator("#startFreeBtn").click();
  await expect(page.locator("#genStepRequest")).toHaveAttribute("data-state", "active");
  await expect(page.locator("#generationProgress")).toBeVisible();
  await expect(page.getByRole("button", { name: "查询进度" })).toHaveCount(0);
  flow.state.order = freeOrder({ status: "ready", imageUrl: IMAGE_PATH });
  await page.clock.fastForward(5000);
  await expect(page.locator("#surveyStep")).toBeVisible();
  await page.locator('[data-satisfaction="1"]').click();
  await expect(page.locator("#unsatisfiedGuide")).toBeVisible();
  await expect(page.locator("#regeneratePhotoBtn")).toBeVisible();
  await expect(page.locator("#regenerateRoleBtn")).toBeVisible();
  await expect(page.locator("#unsatisfiedText")).toContainText("第 2 次免费机会");
  await page.locator("#regenerateRoleBtn").click();
  await expect(page.locator("#roleStep")).toBeVisible();
  await page.locator("#useResultRole").click();
  await expect(page.locator("#photoStep")).toBeVisible();
  await expect(page.locator("#photoPreview")).toBeVisible();
  await expect(page.locator("#startFreeBtn")).toBeEnabled();
  await page.locator("#startFreeBtn").click();
  await expect.poll(() => flow.calls.posts.length).toBe(2);
  expect(flow.calls.posts[0].regenerate).toBe(false);
  expect(flow.calls.posts[1].regenerate).toBe(true);
});

test("不满意时换照片再试清空预览与同意勾选，重新上传后 regenerate=true", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }), onFeedback: answersFeedback });
  await page.locator("#customBtn").click();
  await page.locator('[data-satisfaction="1"]').click();
  await page.locator("#regeneratePhotoBtn").click();
  await expect(page.locator("#photoStep")).toBeVisible();
  await expect(page.locator("#photoPreview")).toBeHidden();
  await expect(page.locator("#photoConsent")).not.toBeChecked();
  await expect(page.locator("#uploadPhotoBtn")).toBeVisible();
  await selectPhoto(page);
  await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#startFreeBtn")).toBeVisible();
  await page.locator("#startFreeBtn").click();
  await expect.poll(() => flow.calls.posts.length).toBe(1);
  expect(flow.calls.posts[0].regenerate).toBe(true);
});

test("本机免费次数用完且不满意时只显示改进建议，不显示重试按钮", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page, {
    order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }),
    free: quota({ used: 14, remaining: 986, browserUsed: 2, browserRemaining: 0, browserExhausted: true, reason: "BROWSER_LIMIT" }),
    onFeedback: answersFeedback,
  });
  await page.locator("#customBtn").click();
  await page.locator('[data-satisfaction="1"]').click();
  await expect(page.locator("#unsatisfiedGuide")).toBeVisible();
  await expect(page.locator("#unsatisfiedText")).toContainText("建议换一张正脸更清晰");
  await expect(page.locator("#regeneratePhotoBtn")).toBeHidden();
  await expect(page.locator("#regenerateRoleBtn")).toBeHidden();
  await expect(page.locator("#retryJobBtn")).toBeHidden();
});

test("生成失败提示不占用免费次数，重试请求 regenerate=true", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page, {
    post: { order: freeOrder({ status: "failed", retryable: true, errorCode: "GENERATION_FAILED" }), free: quota(), feedback: null, idempotent: false },
  });
  await uploadPhoto(page);
  await page.locator("#startFreeBtn").click();
  await expect(page.locator("#generationMessage")).toContainText("本次不占用免费次数");
  await expect(page.locator("#retryJobBtn")).toBeVisible();
  await page.locator("#retryJobBtn").click();
  await expect.poll(() => flow.calls.posts.length).toBe(2);
  expect(flow.calls.posts[1].regenerate).toBe(true);
});

test("打赏链接指向爱发电且不携带订单关联参数", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }) });
  await page.locator("#customBtn").click();
  const tip = page.locator("#tipAuthorLink");
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute("href", TIP_URL);
  await expect(tip).toHaveAttribute("target", "_blank");
  await expect(tip).toHaveAttribute("rel", "noopener noreferrer");
  const url = new URL(await tip.getAttribute("href"));
  expect(url.searchParams.has("remark")).toBe(false);
  expect(url.searchParams.has("custom_order_id")).toBe(false);
});

test("减少动态效果时流光角标不播放扫光动画", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await resultPage(page, request);
  await mockFreeFlow(page);
  await page.locator("#customBtn").click();
  const animationName = await page.locator("#freeQuotaBadge").evaluate(el => getComputedStyle(el, "::after").animationName);
  expect(animationName).toBe("none");
});

test("320 与 390px 弹窗均无横向溢出", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }) });
  await page.locator("#customBtn").click();
  await expect(page.locator("#surveyStep")).toBeVisible();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator("#customDialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

test("照片上传超过30秒仍等待完成，不因普通查询限时取消", async ({ page, request }) => {
  test.setTimeout(75000);
  await resultPage(page, request);
  await mockFreeFlow(page);
  await page.unroute("**/api/photos");
  await page.route("**/api/photos", async route => {
    await new Promise(resolve => setTimeout(resolve, 35000));
    await route.fulfill({ status: 201, json: { photoId: "test-photo", expiresAt: EXPIRES } }).catch(() => {});
  });
  await page.locator("#customBtn").click(); await page.locator("#useResultRole").click();
  await selectPhoto(page); await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#uploadPhotoBtn")).toBeDisabled();
  await expect(page.locator("#startFreeBtn")).toBeVisible({ timeout: 45000 });
  await expect(page.locator("#customError")).toBeHidden();
  await expect(page.locator("#photoHelp")).toContainText("照片上传完成");
});

for (const [networkError, message] of [["timedout", "照片上传超时"], ["internetdisconnected", "网络连接中断"]]) {
test(`上传${networkError}显示明确提示，保留预览并允许直接重试`, async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page);
  let attempts = 0;
  await page.route("**/api/photos", route => ++attempts === 1
    ? route.abort(networkError)
    : route.fulfill({ status: 201, json: { photoId: "test-photo", expiresAt: EXPIRES } }));
  await page.locator("#customBtn").click(); await page.locator("#useResultRole").click();
  await selectPhoto(page); await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#customError")).toContainText(message);
  await expect(page.locator("#photoPreview")).toBeVisible();
  await expect(page.locator("#uploadPhotoBtn")).toBeEnabled();
  await page.locator("#uploadPhotoBtn").click();
  await expect(page.locator("#startFreeBtn")).toBeVisible();
  await expect(page.locator("#customError")).toBeHidden();
  expect(attempts).toBe(2);
});
}

test("小照片提示换图，重新打开已生成的免费订单可直接读取头像与问卷", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page);
  await page.locator("#customBtn").click();
  await page.locator("#useResultRole").click();
  await selectPhoto(page, 128);
  await expect(page.locator("#customError")).toContainText("至少 512px");
  await expect(page.locator("#uploadPhotoBtn")).toBeDisabled();
  await page.locator("#closeCustomBtn").click();
  await page.unrouteAll();
  const flow = await mockFreeFlow(page, { order: freeOrder({ status: "ready", imageUrl: IMAGE_PATH }) });
  await page.locator("#customBtn").click();
  await expect(page.locator("#customImage")).toBeVisible();
  await expect(page.locator("#surveyStep")).toBeVisible();
  expect(flow.calls.posts).toHaveLength(0);
});

test("历史付费订单仍可查看头像，但不显示免费问卷", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page, { order: freeOrder({ free: false, amountFen: 180, status: "ready", imageUrl: IMAGE_PATH }) });
  await page.locator("#customBtn").click();
  await expect(page.locator("#customImage")).toBeVisible();
  await expect(page.locator("#saveCustomBtn")).toBeVisible();
  await expect(page.locator("#surveyStep")).toBeHidden();
  await expect(page.locator("#tipAuthorLink")).toBeVisible();
  expect(flow.calls.posts).toHaveLength(0);
});

test("历史待付款订单提示联系作者且不进入免费流程", async ({ page, request }) => {
  await resultPage(page, request);
  await mockFreeFlow(page, { order: freeOrder({ free: false, amountFen: 180, status: "unpaid", imageUrl: null }) });
  await page.locator("#customBtn").click();
  await expect(page.locator("#generationMessage")).toContainText("之前创建过付款订单，请联系作者");
  await expect(page.locator("#retryJobBtn")).toBeHidden();
  await expect(page.locator("#surveyStep")).toBeHidden();
});

test("选择其它角色可逐张查看 16 个参考图，并将选择带入免费生成", async ({ page, request }) => {
  await resultPage(page, request);
  const flow = await mockFreeFlow(page);
  const roles = (await (await request.get("/data/quiz-cat.json")).json()).characters;
  await page.locator("#customBtn").click();
  await expect(page.locator("#customBtn")).toContainText("定制宠物万圣节装扮头像");
  await page.locator("#browseRoles").click();
  while (await page.locator("#previousRole").isEnabled()) await page.locator("#previousRole").click();
  await expect.poll(() => page.locator("#browseRoleImage").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await page.locator("#browseRoleImage").evaluate(img => img.style.transform)).toBe("translate(0%, 0%)");
  await page.locator("#nextRole").click();
  await expect(page.locator("#roleCount")).toHaveText("2 / 16");
  await page.locator("#chooseRole").click();
  await expect(page.locator("#selectedRoleName")).toHaveText(roles[1].name);
  await selectPhoto(page);
  await page.locator("#photoConsent").check();
  await page.locator("#uploadPhotoBtn").click();
  await page.locator("#startFreeBtn").click();
  await expect.poll(() => flow.calls.posts.length).toBe(1);
  expect(flow.calls.posts[0].roleId).toBe(roles[1].id);
});

test("慢网核单和预览失败均不会锁住角色选择", async ({ page, request }) => {
  await resultPage(page, request);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await mockFreeFlow(page);
  await page.route("**/api/config**", async route => { await gate; await route.fulfill({ json: serviceConfig() }); });
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
  await resultPage(page, request); await mockFreeFlow(page);
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
  await mockFreeFlow(page);
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

test("狗结果与选角图集只使用狗素材", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seen = [];
  page.on("request", req => { if (/\/(static-cards|role-thumbnails)\//.test(new URL(req.url()).pathname)) seen.push(new URL(req.url()).pathname); });
  await resultPage(page, request, "dog"); await mockFreeFlow(page);
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
