import { test, expect } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";
import { PNG } from "pngjs";

async function answerN(page, n, pick = 0) {
  for (let i = 0; i < n; i++) {
    const progress = await page.locator("#progress").innerText();
    await expect(page.locator("#options .option")).toHaveCount(5);
    await page.locator("#options .option").nth(pick).click();
    if (progress.includes("10 / 10")) {
      await expect(page).toHaveURL(/\/result(?:\.html)?(?:\?.*)?$/, { timeout: 15_000 });
    } else {
      await expect(page.locator("#progress")).not.toHaveText(progress);
    }
  }
}

async function startQuiz(page, name) {
  await page.goto("/");
  if (name) await page.getByLabel("请输入宠物姓名", { exact: true }).fill(name);
  await page.locator("#startBtn").click();
  await expect(page).toHaveURL(/\/quiz(?:\.html)?$/);
  await expect(page.locator("#options .option").first()).toBeVisible();
}

async function readState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("peti:v1")));
}

async function seedPage(page, state, path = "/result.html") {
  await page.goto("/");
  await page.evaluate((value) => localStorage.setItem("peti:v1", JSON.stringify(value)), state);
  await page.goto(path);
  await expect(page.locator("#roleName")).toBeVisible();
}

async function expectNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.describe("首页与答题", () => {
  test("首页表单叠在主视觉内，姓名为空，历史空态不展示无效入口", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero")).toBeVisible();
    await expect(page.getByLabel("请输入宠物姓名", { exact: true })).toHaveValue("");
    expect((await page.locator("#petName").getAttribute("placeholder")) || "").toBe("");
    await expect(page.locator('.type-btn[data-type="cat"]')).toBeVisible();
    await expect(page.locator('.type-btn[data-type="dog"]')).toBeVisible();
    await expect(page.locator("#continueBtn")).toBeHidden();
    await expect(page.locator("#historySection")).toBeHidden();
    await expect(page.locator("#recoverForm")).toHaveCount(0);
    const hero = await page.locator(".hero").boundingBox();
    const start = await page.locator("#startBtn").boundingBox();
    expect(start.y).toBeGreaterThan(hero.y);
    expect(start.y + start.height).toBeLessThanOrEqual(hero.y + hero.height);
  });

  test("名字超 12 字报错并保留输入", async ({ page }) => {
    await page.goto("/");
    await page.locator("#petName").fill("一二三四五六七八九十十一二");
    await page.locator("#startBtn").click();
    await expect(page.locator("#nameError")).toContainText("1–12 字");
    await expect(page.locator("#petName")).toHaveValue("一二三四五六七八九十十一二");
  });

  test("选项自动推进，图标返回保留已选答案与顺序，刷新稳定", async ({ page }) => {
    await startQuiz(page, "馒头");
    const order = await page.locator("#options .option").allTextContents();
    await expect(page.locator("#nextBtn")).toHaveCount(0);
    await expect(page.locator("#prevBtn")).toHaveAccessibleName("返回首页");
    const selected = await page.locator("#options .option").nth(1).getAttribute("data-oid");
    await page.locator("#options .option").nth(1).click();
    await expect(page.locator("#progress")).toHaveText("第 2 / 10 题");
    await expect(page.locator("#prevBtn")).toHaveAccessibleName("返回上一题");
    await page.locator("#prevBtn").click();
    await expect(page.locator("#progress")).toHaveText("第 1 / 10 题");
    await expect(page.locator("#options .option.selected")).toHaveAttribute("data-oid", selected);
    expect(await page.locator("#options .option").allTextContents()).toEqual(order);
    await page.reload();
    await expect(page.locator("#options .option.selected")).toHaveAttribute("data-oid", selected);
    expect(await page.locator("#options .option").allTextContents()).toEqual(order);
  });

  test("旧会话只有 4 个旧选项时自动补齐为 5 个", async ({ page }) => {
    await startQuiz(page, "旧会话");
    const state = await readState(page);
    const legacy = state.order.q1.filter((id) => /[a-d]$/.test(id));
    expect(legacy).toHaveLength(4);
    state.order.q1 = legacy;
    await page.evaluate((value) => localStorage.setItem("peti:v1", JSON.stringify(value)), state);
    await page.reload();
    await expect(page.locator("#progress")).toHaveText("第 1 / 10 题");
    await expect(page.locator("#options .option")).toHaveCount(5);
    const after = await readState(page);
    expect(after.order.q1).toHaveLength(5);
    expect(new Set(after.order.q1).size).toBe(5);
    expect(after.order.q1.filter((id) => !legacy.includes(id))).toEqual(["q1n"]);
  });

  test("十题全选中庸选项仍可提交并展示结果", async ({ page }) => {
    await startQuiz(page, "中立");
    for (let i = 0; i < 10; i++) {
      const progress = await page.locator("#progress").innerText();
      const neutral = page.locator('#options .option[data-oid$="n"]');
      await expect(neutral).toHaveCount(1);
      await neutral.click();
      if (progress.includes("10 / 10")) {
        await expect(page).toHaveURL(/\/result(?:\.html)?(?:\?.*)?$/, { timeout: 15_000 });
      } else {
        await expect(page.locator("#progress")).not.toHaveText(progress);
      }
    }
    await expect(page.locator("#roleName")).toBeVisible();
    await expect(page.locator("#rarity")).toContainText("概率为");
  });

  test("快速重复选择只回答当前一题", async ({ page }) => {
    await startQuiz(page);
    await page.locator("#options .option").first().evaluate((button) => {
      button.click();
      button.click();
    });
    await expect(page.locator("#progress")).toHaveText("第 2 / 10 题");
    expect(Object.keys((await readState(page)).answers)).toHaveLength(1);
  });

  test("答题期间预下载图集与结果卡，不阻塞继续作答", async ({ page }) => {
    const downloaded = new Set();
    page.on("requestfinished", request => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/static-cards/") || path === "/role-thumbnails/20261030-v2/cat/atlas.webp") downloaded.add(path);
    });
    await startQuiz(page, "提前缓存");
    await answerN(page, 1);
    await expect.poll(() => downloaded.size, { timeout: 30000 }).toBe(17);
    await answerN(page, 9);
    await expect(page.locator("#roleName")).toBeVisible();
    await expect(page.locator("#saveCardBtn")).toBeEnabled();
    const image = await page.locator("#roleCardImage").evaluate(img => ({ url: img.currentSrc, width: img.naturalWidth }));
    expect(image.width).toBe(900);
    expect(downloaded.has(new URL(image.url).pathname)).toBe(true);
  });

  test("省流量模式不会后台预下载全部卡片", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true }));
    const downloads = [];
    page.on("request", request => { if (/\/(static-cards|role-thumbnails)\//.test(new URL(request.url()).pathname)) downloads.push(request.url()); });
    await startQuiz(page, "省流量");
    await answerN(page, 1);
    expect(downloads).toHaveLength(0);
  });

  test("另一个标签开始新测后，旧答题页不能覆盖新进度", async ({ page, context }) => {
    await startQuiz(page, "馒头");
    const old = await readState(page);
    const secondPage = await context.newPage();
    await startQuiz(secondPage, "团子");
    const active = await readState(secondPage);
    expect(active.testId).not.toBe(old.testId);
    await page.locator("#options .option").first().click();
    await expect(page.locator("#quizError")).toHaveText("另一场测试已在本浏览器开始，请返回首页继续");
    expect((await readState(page)).testId).toBe(active.testId);
    expect((await readState(page)).answers).toEqual({});
    await expect(page.locator("#prevBtn")).toHaveAccessibleName("返回首页");
    await page.locator("#prevBtn").click();
    await expect(page).toHaveURL(/\/(?:index\.html)?$/);
    await secondPage.close();
  });

  test("末题自动提交，失败保留答案并可重试", async ({ page }) => {
    await startQuiz(page);
    await answerN(page, 9);
    let submissions = 0;
    await page.route("**/api/results", async (route) => {
      submissions += 1;
      if (submissions === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SERVER_ERROR", retryable: true }) });
      } else {
        await route.continue();
      }
    });
    await page.locator("#options .option").first().click();
    await expect(page.locator("#quizError")).toBeVisible();
    await expect(page.locator("#retryBtn")).toBeVisible();
    expect(Object.keys((await readState(page)).answers)).toHaveLength(10);
    await page.locator("#retryBtn").click();
    await expect(page).toHaveURL(/\/result(?:\.html)?(?:\?.*)?$/, { timeout: 15_000 });
    await expect(page.locator("#roleName")).toBeVisible();
    expect(submissions).toBe(2);
  });

  test("音乐支持开启和静音，并记住跨页偏好", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#audioToggle")).toBeVisible();
    if ((await page.locator("#audioToggle").getAttribute("aria-pressed")) !== "true") {
      await page.locator("#audioToggle").click();
    }
    await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#audioToggle").click();
    await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#startBtn").click();
    await expect(page).toHaveURL(/\/quiz(?:\.html)?$/);
    await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("peti:audio:v1")).muted)).toBe(true);
  });

  test("切到后台时暂停音乐，回到前台继续播放", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator("#audioToggle");
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.querySelector("audio").paused)).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    expect(await page.evaluate(() => document.querySelector("audio").paused)).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await page.evaluate(() => document.querySelector("audio").paused)).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => page.evaluate(() => document.querySelector("audio").paused)).toBe(false);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    expect(await page.evaluate(() => document.querySelector("audio").paused)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect.poll(() => page.evaluate(() => document.querySelector("audio").paused)).toBe(false);
  });
});

test.describe("结果、历史与接口", () => {
  let session;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await startQuiz(page, "馒头");
    await answerN(page, 10);
    await expect(page.locator("#roleName")).toBeVisible();
    session = await readState(page);
    await page.close();
  });

  test("结果顺序符合角色展示层级，免费卡与雷达已渲染，无公开编号", async ({ page }) => {
    await seedPage(page, session);
    await expect(page.locator("#roleName")).toHaveText(/咪$/);
    await expect(page.locator(".result-lead")).toHaveText("馒头万圣节会扮演的角色是…");
    await expect(page.locator("#rarity")).toHaveText(`抽中该万圣节喵喵卡的概率为 ${session.result.rarityPct}%`);
    await expect(page.locator("#publicId")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("公开编号");
    await expect(page.locator("#petNameText")).toHaveText("馒头");
    await expect(page.locator("#roleCardImage")).toBeVisible();
    for (const selector of ["#radar"]) {
      await expect.poll(() => page.$eval(selector, (canvas) => canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value) => value !== 0))).toBe(true);
    }
    const rarity = await page.locator("#rarity").boundingBox();
    const lead = await page.locator(".result-lead").boundingBox();
    const role = await page.locator("#roleName").boundingBox();
    const card = await page.locator("#roleCardImage").boundingBox();
    const quote = await page.locator("#quote").boundingBox();
    const radar = await page.locator("#radar").boundingBox();
    expect(lead.y).toBeLessThan(role.y);
    expect(role.y).toBeLessThan(card.y);
    expect(card.y + card.height).toBeLessThanOrEqual(quote.y);
    expect(quote.y).toBeLessThan(rarity.y);
    expect(rarity.y).toBeLessThan(radar.y);
  });

  test("16 个角色都有高清静态卡片和轻量缩略图", async ({ page, request }) => {
    const quiz = await (await request.get("/data/quiz-cat.json")).json();
    for (const role of quiz.characters) {
      for (const folder of ["static-cards", "role-thumbnails"]) {
        const response = await request.get(`/${folder}/20261030-v2/cat/${role.id}.webp`);
        expect(response.ok()).toBe(true);
        expect(response.headers()["content-type"]).toContain("image/webp");
      }
    }
    for (const role of [quiz.characters[0], quiz.characters[8]]) {
      const result = { ...session.result, roleId: role.id, roleName: role.name };
      await seedPage(page, { ...session, result, history: [] });
      await expect(page.locator("#roleCardImage")).toHaveAttribute("src", `/static-cards/20261030-v2/cat/${role.id}.webp`);
      await expect(page.locator("#saveCardBtn")).toBeEnabled();
      expect(await page.locator("#roleCardImage").evaluate(img => [img.naturalWidth, img.naturalHeight])).toEqual([900, 1380]);
    }
  });

  test("分享结果先预览，再保存包含姓名台词雷达和描述的完整 PNG", async ({ page }) => {
    await seedPage(page, session);
    await expect(page.locator("#saveCardBtn")).toHaveText("分享结果");
    await page.evaluate(() => {
      window.__posterText = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        if (this.canvas.id === "cardCanvas") window.__posterText.push(text);
        return original.call(this, text, ...args);
      };
    });
    await page.locator("#saveCardBtn").click();
    await expect(page.locator("#shareDialog")).toBeVisible();
    await expect.poll(() => page.locator("#sharePreviewImage").evaluate(img => img.complete && img.naturalWidth)).toBe(900);
    const drawnText = await page.evaluate(() => window.__posterText.join(""));
    for (const text of [session.petName, session.result.roleName, session.result.quote, session.result.tagline, ...session.result.shortLines]) expect(drawnText).toContain(text);
    await expect(page.locator("#sharePreviewImage")).toHaveAttribute("alt", /电量.*贴贴.*胆量.*戏精.*干饭.*好奇/);
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#saveShareImage").click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    expect((await stat(await download.path())).size).toBeGreaterThan(10_000);
    const png = PNG.sync.read(await readFile(await download.path()));
    expect(png.width).toBe(900);
    expect(png.height).toBeGreaterThan(1600);
    await download.saveAs("shots/result-share-poster-20261030.png");
    await page.screenshot({ path: "shots/result-share-dialog-20261030.png" });
    // 分享到朋友圈已移除，只保留下载与长按保存。
    await expect(page.locator("#shareMomentsBtn")).toHaveCount(0);
    await expect(page.locator("#momentsGuide")).toHaveCount(0);
    await expect(page.locator(".share-note")).toContainText("长按预览图片保存");
    await page.locator("#closeShareBtn").click();
    await expect(page.locator("#saveCardBtn")).toBeFocused();
  });

  test("角色集合可进入单角色查看，返回后焦点回到原卡片", async ({ page }) => {
    await seedPage(page, session);
    await expect(page.locator(".avatar-cta-note")).toContainText("上传照片生成毛孩子专属万圣节头像");
    const trigger = page.locator("#roleCollectionBtn");
    await expect(trigger).toHaveText("角色集合");
    expect(await trigger.evaluate(el => getComputedStyle(el).textDecorationLine)).toContain("underline");
    await trigger.click();
    await expect(page.locator("#roleCollectionDialog")).toBeVisible();
    await expect(page.locator("#collectionTitle")).toHaveText("16 个角色");
    await expect(page.locator("#collectionGrid .collection-item")).toHaveCount(16);
    const first = page.locator("#collectionGrid .collection-card").first();
    const firstName = await page.locator("#collectionGrid .collection-name").first().textContent();
    await expect(page.locator("#collectionGrid .collection-name").first()).toHaveText(/咪$/);
    await first.click();
    await expect(page.locator("#collectionGrid")).toBeHidden();
    await expect(page.locator("#collectionDetail")).toBeVisible();
    await expect(page.locator("#collectionTitle")).toHaveText(firstName);
    await expect(page.locator("#collectionDetailName")).toHaveText(firstName);
    await expect(page.locator("#collectionDetailMeta")).toContainText("模拟占比");
    await expect(page.locator("#collectionDetailQuote")).toContainText("「");
    await page.setViewportSize({ width: 320, height: 720 });
    expect(await page.locator("#roleCollectionDialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.locator("#collectionBack").click();
    await expect(page.locator("#collectionDetail")).toBeHidden();
    await expect(page.locator("#collectionGrid")).toBeVisible();
    await expect(page.locator("#collectionTitle")).toHaveText("16 个角色");
    await expect(first).toBeFocused();
    await page.locator("#closeCollectionBtn").click();
    await expect(page.locator("#roleCollectionDialog")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("角色卡可打开高清大图、缩放和返回，概率说明支持悬停与键盘", async ({ page }) => {
    await seedPage(page, session);
    await expect(page.locator("#saveCardBtn")).toBeEnabled();
    await page.locator("#rarityInfo").hover();
    await expect(page.locator("#rarityHelp")).toContainText("并非实时用户统计");
    await page.locator("#roleName").hover();
    await expect(page.locator("#rarityHelp")).toBeHidden();
    await page.locator("#rarityInfo").focus();
    await expect(page.locator("#rarityHelp")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#rarityHelp")).toBeHidden();
    await page.locator("#roleCardImage").click();
    await expect(page.locator("#imageViewer")).toBeVisible();
    await expect.poll(() => page.locator("#viewerImage").evaluate(img => img.naturalWidth)).toBe(900);
    // JPG 首次加载比缓存的 WebP 慢，等查看器按视口完成首次缩放后再读初始宽度。
    await expect.poll(() => page.locator("#viewerImage").evaluate(img => img.getBoundingClientRect().width)).toBeLessThan(900);
    const initial = await page.locator("#viewerImage").evaluate(img => img.getBoundingClientRect().width);
    await page.locator("#zoomInImage").click();
    expect(await page.locator("#viewerImage").evaluate(img => img.getBoundingClientRect().width)).toBeGreaterThan(initial);
    await expect(page.locator("#viewerImage")).toHaveAttribute("src", /\/static-cards\/.+\.jpg$/);
    await expect(page.locator("#openOriginalImage")).toHaveAttribute("href", /\/static-cards\/.+\.jpg$/);
    await page.locator("#resetImageZoom").click();
    await expect(page.locator("#resetImageZoom")).toHaveText("1×");
    await page.keyboard.press("Escape");
    await expect(page.locator("#imageViewer")).toBeHidden();
    await expect(page.locator("#viewCardLink")).toBeFocused();
  });

  test("微信手机页可点击概率说明，长按保存引导保留完整图片", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 MicroMessenger/8.0" });
    const page = await context.newPage();
    try {
      await seedPage(page, { ...session, petType: "dog", petName: "一二三四五六七八九十十一" });
      await expectNoOverflow(page);
      await expect(page.locator("#rarity")).toContainText("汪汪卡");
      await page.locator("#rarityInfo").tap();
      await expect(page.locator("#rarityHelp")).toBeVisible();
      await page.locator("#rarityInfo").tap();
      await expect(page.locator("#rarityHelp")).toBeHidden();
      await page.locator("#saveCardBtn").click();
      await expect(page.locator("#saveShareImage")).toBeVisible();
      await page.locator("#saveShareImage").tap();
      await expect(page.locator("#shareStatus")).toHaveText("请长按上方图片，选择保存到手机。");
      await page.locator("#previewShareLarge").tap();
      await expect(page.locator("#imageViewer")).toBeVisible();
      await page.locator("#zoomInImage").tap();
      await expect(page.locator("#resetImageZoom")).toHaveText("1.5×");
      await page.locator("#closeImageViewer").tap();
      await expect(page.locator("#shareDialog")).toBeVisible();
      await page.screenshot({ path: "shots/result-mobile-share-20261030.png" });
    } finally { await context.close(); }
  });

  test("静态卡片尺寸适合手机并保持居中", async ({ page }) => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await seedPage(page, session);
      await expectNoOverflow(page);
      const name = await page.locator(".result-header").boundingBox();
      const traits = await page.locator(".traits-layout").boundingBox();
      const card = await page.locator("#roleCardImage").boundingBox();
      expect(Math.abs(name.x + name.width / 2 - width / 2)).toBeLessThan(2);
      expect(Math.abs(traits.x + traits.width / 2 - width / 2)).toBeLessThan(2);
      expect(Math.abs(card.x + card.width / 2 - width / 2)).toBeLessThan(2);
      expect(card.width).toBeLessThanOrEqual(250);
      expect(card.height).toBeLessThan(390);
      expect(card.width / card.height).toBeCloseTo(900 / 1380, 2);
    }
  });

  test("禁用 WebGL 后仍能展示并保存静态卡片", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type.startsWith("webgl")) throw new Error("WebGL must not be used");
        return original.call(this, type, ...args);
      };
    });
    await seedPage(page, session);
    await expect(page.locator("#roleCardImage")).toBeVisible();
    await expect(page.locator("#saveCardBtn")).toBeEnabled();
    await expect(page.locator("iframe")).toHaveCount(0);
  });

  test("改名有保存与取消，成功状态明确，重新查看历史保留新名", async ({ page }) => {
    await seedPage(page, session);
    await page.locator("#saveCardBtn").click();
    await expect(page.locator("#saveShareImage")).toBeVisible();
    const previousPoster = await page.locator("#saveShareImage").getAttribute("href");
    await page.locator("#closeShareBtn").click();
    await page.locator("#renameBtn").click();
    await page.locator("#petNameInput").fill("煤球");
    await page.locator("#cancelNameBtn").click();
    await expect(page.locator("#petNameText")).toHaveText("馒头");
    await page.locator("#renameBtn").click();
    await page.locator("#petNameInput").fill("煤球");
    await page.locator("#saveNameBtn").click();
    await expect(page.locator("#petNameText")).toHaveText("煤球");
    await expect(page.locator("#petNameInput")).toBeHidden();
    await expect(page.locator("#nameStatus")).toHaveText("名字已保存");
    await page.locator("#saveCardBtn").click();
    await expect(page.locator("#sharePreviewImage")).toHaveAttribute("alt", /^煤球的测评结果/);
    expect(await page.locator("#saveShareImage").getAttribute("href")).not.toBe(previousPoster);
    await page.locator("#closeShareBtn").click();
    await page.goto("/");
    await expect(page.locator("#historyList")).toContainText("煤球");
    await page.locator("a.history-item").filter({ hasText: "煤球" }).click();
    await expect(page.locator("#petNameText")).toHaveText("煤球");
  });

  test("新测不会覆盖旧结果，历史可见且查看旧结果不丢失答题进度", async ({ page }) => {
    await seedPage(page, session);
    await page.goto("/");
    await expect(page.locator("a.history-item")).toHaveCount(1);
    await page.locator("#petName").fill("团子");
    await page.locator("#startBtn").click();
    await expect(page).toHaveURL(/\/quiz(?:\.html)?$/);
    await answerN(page, 1);
    const active = await readState(page);
    expect(active.testId).not.toBe(session.testId);
    await page.goto("/");
    await expect(page.locator("#continueBtn")).toBeVisible();
    await page.locator("a.history-item").filter({ hasText: "馒头" }).click();
    await expect(page.locator("#petNameText")).toHaveText("馒头");
    const afterHistory = await readState(page);
    expect(afterHistory.testId).toBe(active.testId);
    expect(afterHistory.answers).toEqual(active.answers);
    await page.goto("/");
    await page.locator("#continueBtn").click();
    await expect(page.locator("#progress")).toHaveText("第 2 / 10 题");
    await answerN(page, 9);
    await page.goto("/");
    await expect(page.locator("a.history-item")).toHaveCount(2);
    await expect(page.locator("#historyList")).toContainText("馒头");
    await expect(page.locator("#historyList")).toContainText("团子");
    await page.reload();
    await expect(page.locator("a.history-item")).toHaveCount(2);
  });

  test("本地结果缓存缺失时自动通过原凭证恢复", async ({ page }) => {
    await seedPage(page, { ...session, result: null, history: [] });
    await expect(page.locator("#roleName")).toHaveText(session.result.roleName);
    expect((await readState(page)).result.publicId).toBe(session.result.publicId);
  });

  test("提交响应晚到时归档原结果，并保留另一场新会话", async ({ page }) => {
    await startQuiz(page, "馒头");
    await answerN(page, 9);
    const original = await readState(page);
    let newSession;
    await page.route("**/api/results", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      newSession = await (await page.request.post("/api/sessions", {
        data: { petType: "cat", quizVersion: "cat-2026v4", source: "test" },
      })).json();
      await page.evaluate((state) => localStorage.setItem("peti:v1", JSON.stringify(state)), {
        ...original, ...newSession, petName: "团子", answers: {}, currentQ: 0, result: null,
      });
      await route.fulfill({ response });
    });
    await page.locator("#options .option").first().click();
    await expect(page).toHaveURL(new RegExp(`/result(?:\\.html)?\\?testId=${original.testId}$`), { timeout: 15_000 });
    await expect(page.locator("#petNameText")).toHaveText("馒头");
    const active = await readState(page);
    expect(active.testId).toBe(newSession.testId);
    expect(active.result).toBeNull();
    expect(active.answers).toEqual({});
    expect(active.history.find((entry) => entry.testId === original.testId)?.result.roleName).toBeTruthy();
    expect(active.history.some((entry) => entry.testId === newSession.testId)).toBe(false);
  });

  test("提交幂等：同凭证重复提交返回原 publicId", async ({ request }) => {
    const body = { token: session.token, testId: session.testId, optionIds: Array.from({ length: 10 }, (_, i) => `q${i + 1}a`), petName: "馒头" };
    for (let i = 0; i < 2; i++) {
      const response = await request.post("/api/results", { data: body });
      expect(response.ok()).toBe(true);
      expect((await response.json()).publicId).toBe(session.result.publicId);
    }
  });

  test("后台恢复仍验证凭证，错误凭证统一失败", async ({ request }) => {
    const valid = await request.post("/api/recover", { data: { token: session.token, testId: session.testId } });
    expect(valid.ok()).toBe(true);
    expect((await valid.json()).publicId).toBe(session.result.publicId);
    for (const testId of [session.testId, "missing-test"]) {
      const response = await request.post("/api/recover", { data: { token: "00000000000000000000000000000000", testId } });
      expect(response.status()).toBe(401);
      const error = await response.json();
      expect(error.code).toBe("TOKEN_INVALID");
      expect(error.message).toBe("口令无效或已超过保留期");
    }
  });

  test("320px 与 390px 不横向溢出，雷达图位于描述左侧且缩小", async ({ page }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await expectNoOverflow(page);
      await seedPage(page, session);
      await expectNoOverflow(page);
      const radar = await page.locator("#radar").boundingBox();
      const description = await page.locator("#shortLines").boundingBox();
      expect(radar.x + radar.width).toBeLessThanOrEqual(description.x + 1);
      expect(radar.width).toBeLessThanOrEqual(180);
      const card = await page.locator("#roleCardImage").boundingBox();
      expect(Math.abs(card.x + card.width / 2 - width / 2)).toBeLessThanOrEqual(2);
    }
    await page.setViewportSize({ width: 390, height: 500 });
    await startQuiz(page);
    await expectNoOverflow(page);
    await page.locator("#options .option").last().scrollIntoViewIfNeeded();
    await page.locator("#options .option").last().click();
    await expect(page.locator("#progress")).toHaveText("第 2 / 10 题");
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const question = await page.locator("#qtext").boundingBox();
    expect(question.y).toBeGreaterThan(100);
  });
});

test.describe("接口校验与狗版", () => {
  test("quizVersion 与 petType 不匹配返回 PARAM_MISSING", async ({ request }) => {
    const response = await request.post("/api/sessions", { data: { petType: "cat", quizVersion: "dog-2026v4", source: "test" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe("PARAM_MISSING");
  });

  test("petName 超 12 码点返回 PET_NAME_TOO_LONG", async ({ request }) => {
    const session = await (await request.post("/api/sessions", { data: { petType: "cat", quizVersion: "cat-2026v4", source: "test" } })).json();
    const response = await request.post("/api/results", { data: { ...session, optionIds: Array.from({ length: 10 }, (_, i) => `q${i + 1}a`), petName: "一二三四五六七八九十十一二" } });
    expect((await response.json()).code).toBe("PET_NAME_TOO_LONG");
  });

  test("狗版全链路使用汪角色与狗版默认名", async ({ page }) => {
    await page.goto("/");
    await page.locator('.type-btn[data-type="dog"]').click();
    await page.locator("#startBtn").click();
    await expect(page).toHaveURL(/\/quiz(?:\.html)?$/);
    await answerN(page, 10);
    await expect(page.locator("#roleName")).toHaveText(/汪$/);
    await expect(page.locator("#petNameText")).toHaveText("我家狗");
  });
});
