import { track, observeView } from "./track.js";
import { roleAtlasUrl } from "./role-assets.js";
import { fetchQuiz, getState, setState, saveGeneration } from "./store.js";
import { jpegBlobFromImage, shareOrDownload } from "./save-image.js";

const $ = (id) => document.getElementById(id);
const show = (id, visible = true) => $(id).classList.toggle("hidden", !visible);

// 免费流程文案集中维护，避免各分支出现付款或退款表述。
const TEXT = {
  badge: (remaining) => `限时免费 · 剩 ${remaining} 份`,
  closed: "免费通道已关闭",
  maintenanceBadge: "免费生图维护中",
  helpNormal: (data) => `现在生成头像免费：每个浏览器最多 ${data?.perBrowser ?? 2} 次，全站限量 ${data?.total ?? 1000} 份。生成失败或超时会退还次数。`,
  helpClosed: (data) => `这轮 ${data?.total ?? 1000} 份免费头像已经领完啦。角色卡和测评结果仍然可以保存，感谢参与。`,
  browserLimit: "这台浏览器已经免费生成过 2 次了。可以换个浏览器，或等下一轮开放再来。",
  serviceNotConfigured: "免费生图通道正在准备中，请稍后再来。",
  maintenance: "生图服务正在维护，暂时无法开始生成，请稍后再试。已填写的照片和选择会保留。",
  failed: "这次生成没有完成，本次不占用免费次数。可以换一张照片或换个角色再试一次。",
  uncertain: "生成结果还在确认中，本次暂不占用免费次数；如果稍后收到头像，会直接显示在这里。",
  unsatisfiedWithQuota: "没关系，可以换一张照片或换个角色再生成一次（本次会使用第 2 次免费机会）。",
  unsatisfiedNoQuota: "没关系，这张可以先保存。建议换一张正脸更清晰、光线更均匀的照片，或选一个更贴近它性格的角色，下次开放时再试。",
  feedbackFailed: "反馈暂时没有保存成功，不影响头像保存，可以稍后再试",
  legacy: "这份测评之前创建过付款订单，请联系作者处理。",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function initCustom(getEntry, openViewer) {
  const dialog = $("customDialog");
  let entry, photo, order, config, normalized, previewUrl, outputUrl, roles = [], selectedRole, roleIndex = 0, touchStart;
  let avatarJpeg = null, avatarJpegRequest = null;
  let free = null, feedback = null, browserId = null, regenerating = false;
  let serviceSnapshot = null, servicePrefetch = null;
  let waitStarted = null, waitSegment = null, waitTimer = null;
  const completedSurveys = new Set();
  let lastObservedStatus = "";
  const context = () => ({ test_id: entry?.testId, order_id: order?.orderId, attempt_id: order?.attemptId,
    pet_type: entry?.petType, selected_role_id: selectedRole?.id || order?.roleId,
    service_available: config?.available ?? serviceSnapshot?.available ?? null,
    availability_reason: free?.reason || serviceSnapshot?.free?.reason || null });
  function endWait(reason) {
    if (waitStarted === null) return;
    track("generation_wait_pause", { ...context(), wait_segment_id: waitSegment, visible_wait_ms: Date.now() - waitStarted, reason });
    waitStarted = null; clearInterval(waitTimer); waitTimer = null;
  }
  function beginWait() {
    if (waitStarted !== null || !dialog.open || document.hidden) return;
    waitStarted = Date.now(); waitSegment = crypto.randomUUID();
    track("generation_wait_view", { ...context(), wait_segment_id: waitSegment, order_status: order?.status });
    waitTimer = setInterval(() => track("generation_wait_checkpoint", { ...context(), wait_segment_id: waitSegment, visible_wait_ms: Date.now() - waitStarted }), 15000);
  }
  observeView($("surveyHeading"), "survey_view", context, () => order?.attemptId || "");
  observeView($("tipAuthorLink"), "tip_entry_view", context, () => order?.attemptId || "");
  observeView($("customImage"), "generated_image_view", context, () => order?.attemptId || "");
  for (const [id, question] of [["surveyHeading", "satisfaction"], ["similarityQuestion", "similarity"], ["priceQuestion", "priceBand"], ["issueQuestion", "issue"], ["spendQuestion", "spendHistory"]]) {
    observeView($(id), "survey_question_view", () => ({ ...context(), question_id: question }), () => order?.attemptId || "");
  }
  $("tipAuthorLink").addEventListener("click", () => track("tip_click", context()));
  let busy = false, pollTimer, pollStart, imageLoading = false, surveyFocusAttempt = null;
  let restoring = false, pickingPhoto = false, opening = 0;
  const roleImage = $("browseRoleImage");
  let roleRequest;
  function loadRoles() {
    roleRequest ||= fetchQuiz(getEntry().petType).then((quiz) => quiz.characters).catch((err) => { roleRequest = null; throw err; });
    return roleRequest;
  }
  function loadRoleAtlas(active = false) {
    if (active) roleImage.fetchPriority = "high";
    if (!roleImage.getAttribute("src")) {
      roleImage.fetchPriority = active ? "high" : "low";
      roleImage.src = roleAtlasUrl(getEntry().petType);
    }
  }
  roleImage.addEventListener("load", () => { show("roleImageStatus", false); show("browseRoleImage"); });
  roleImage.addEventListener("error", () => {
    show("roleImageStatus"); $("roleImageStatus").textContent = "角色图片加载失败，请刷新页面重试";
  });
  // 主卡显示完成后再预热角色数据和图集，不抢占主卡下载。
  $("roleCardImage").addEventListener("load", () => {
    if (navigator.connection?.saveData) return;
    void loadRoles().catch(() => {});
    loadRoleAtlas();
  }, { once: true });

  function error(message) { $("customError").textContent = message; show("customError", Boolean(message)); }
  function progress(message) { $("customProgress").textContent = message; }
  function ensureBrowserId() {
    if (browserId) return browserId;
    const saved = getState().anonId;
    if (typeof saved === "string" && UUID.test(saved)) { browserId = saved; return browserId; }
    browserId = crypto.randomUUID();
    setState({ anonId: browserId });
    return browserId;
  }
  // 页面打开就先拿一次服务状态：额度用尽时可以直接拦在定制按钮上，不用先进流程。
  function prefetchService() {
    if (servicePrefetch) return servicePrefetch;
    const id = ensureBrowserId();
    servicePrefetch = fetch(`/api/config?browserId=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data) serviceSnapshot = data; document.documentElement.dataset.service = "ready"; return data; })
      .catch(() => null);
    return servicePrefetch;
  }
  function openQuotaClosed() {
    const notice = $("quotaClosedDialog");
    if (notice && !notice.open) notice.showModal();
  }
  function freeState() { return free || config?.free || null; }
  function renderQuota() {
    const data = freeState();
    const badge = $("freeQuotaBadge");
    const unavailable = Boolean(config && !config.available) || data?.enabled === false;
    const closed = Boolean(data?.exhausted);
    badge.dataset.state = closed || unavailable ? "closed" : "open";
    badge.querySelector(".quota-badge-label").textContent = closed
      ? TEXT.closed
      : unavailable ? TEXT.maintenanceBadge : TEXT.badge(data?.remaining ?? 0);
    // 维护与未配置都先说明原因，避免角标显示可用的同时按钮点不动。
    $("freeQuotaHelp").textContent = closed ? TEXT.helpClosed(data)
      : data?.enabled === false ? TEXT.serviceNotConfigured
      : unavailable ? (config?.free?.reason === "DELIVERY_UNAVAILABLE" ? TEXT.maintenance : TEXT.serviceNotConfigured)
      : TEXT.helpNormal(data);
  }
  function renderQuotaNote() {
    const note = $("freeQuotaNote");
    const data = freeState();
    if (!data) { note.textContent = ""; return; }
    if (data.exhausted) { note.textContent = TEXT.helpClosed(data); return; }
    if (data.browserExhausted) { note.textContent = TEXT.browserLimit; return; }
    if (!config?.available) {
      // 维护原因以 /api/config 为准；订单查询接口只返回额度快照。
      const reason = config?.free?.reason || data.reason;
      note.textContent = reason === "DELIVERY_UNAVAILABLE" ? TEXT.maintenance : TEXT.serviceNotConfigured;
      return;
    }
    if (data.browserRemaining == null) { note.textContent = TEXT.helpNormal(data); return; }
    note.textContent = `这台浏览器还可以免费生成 ${data.browserRemaining} 次。`;
  }
  function quotaAllowsRegenerate() {
    const data = freeState();
    return Boolean(data && !data.exhausted && data.browserRemaining > 0);
  }
  function canStartFree() {
    const data = freeState();
    return Boolean(config?.available && !busy && !restoring && photo && $("photoConsent").checked
      && (!order || order.free) && data && !data.exhausted && !data.browserExhausted);
  }
  function buttons() {
    $("useResultRole").disabled = busy || !roles.length;
    $("browseRoles").disabled = busy || !roles.length;
    $("uploadPhotoBtn").disabled = busy || restoring || !normalized || !$("photoConsent").checked;
    $("startFreeBtn").disabled = busy || restoring || !canStartFree();
    $("petPhoto").disabled = busy;
    $("pickPhotoBtn").disabled = busy;
    $("photoConsent").disabled = busy;
    $("retryJobBtn").disabled = busy;
    for (const button of document.querySelectorAll(".survey-choice")) button.disabled = busy;
    for (const id of ["regeneratePhotoBtn", "regenerateRoleBtn"]) $(id).disabled = busy;
  }
  async function run(action) {
    if (busy) return;
    busy = true; error(""); buttons();
    try { await action(); }
    catch (err) { progress(""); error(err.message || "连接失败，请重试"); }
    finally { busy = false; buttons(); }
  }
  async function api(path, body) {
    let response;
    try {
      response = await fetch(path, {
        method: body ? "POST" : "GET", cache: "no-store",
        headers: body ? { "content-type": "application/json" } : { "X-PT-Token": entry.token },
        body: body ? JSON.stringify({ ...body, token: entry.token }) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const timedOut = ["AbortError", "TimeoutError"].includes(err.name);
      throw new Error(timedOut ? "连接等待超时，请检查网络后重试。" : "网络连接中断，请检查网络后重试。");
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      const failure = new Error(data?.message || "服务暂时没有返回有效结果，请稍后重试");
      failure.code = data?.code;
      failure.status = response.status;
      throw failure;
    }
    return data;
  }
  function uploadPhoto(form) {
    return new Promise((resolve, reject) => {
      // 上传独立于30秒查单限时；XHR提供真实发送进度，不自动重试以免重复上传。
      const request = new XMLHttpRequest();
      request.open("POST", "/api/photos");
      request.timeout = 120_000;
      request.responseType = "json";
      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.round(event.loaded / event.total * 100);
        progress(percent === 100 ? "照片已发送，正在保存…" : `正在上传照片 ${percent}%…`);
      };
      request.onload = () => {
        const data = request.response;
        if (request.status >= 200 && request.status < 300 && data?.photoId) resolve(data);
        else reject(new Error(data?.message || "上传服务暂时未能保存照片，请稍后重试，所选照片已保留。"));
      };
      request.ontimeout = () => reject(new Error("照片上传超时，所选照片已保留。请检查网络后点击重新上传，或换一张较小的照片。"));
      request.onerror = () => reject(new Error("照片上传时网络连接中断，所选照片已保留。请检查网络后重新上传。"));
      request.onabort = () => reject(new Error("照片上传已中断，所选照片已保留，可以重新上传。"));
      request.send(form);
    });
  }
  function stage(name) {
    if (entry) track("generation_step_view", { ...context(), step: name });
    show("roleStep", name === "role"); show("photoStep", name === "photo"); show("generationStep", name === "generate");
    show("surveyStep", false);
    for (const [key, id] of [["role", "stepRole"], ["photo", "stepPhoto"], ["generate", "stepGenerate"]]) {
      if (key === name) $(id).setAttribute("aria-current", "step"); else $(id).removeAttribute("aria-current");
    }
    $("customTitle").textContent = { role: "想让它扮演谁？", photo: "选一张它的照片", generate: "正在生成万圣节头像" }[name];
    $("customIntro").textContent = {
      role: "用测出的角色，或挑选一个喜欢的造型。",
      photo: "正脸清楚、毛色完整，尽量只有一只毛孩子。",
      generate: "头像会在后台继续生成，不用保持页面打开。",
    }[name];
    dialog.scrollTop = 0;
  }
  function renderRole() {
    const role = roles[roleIndex];
    $("browseRarity").textContent = `测评模拟中 ${role.rarityPct}% 的毛孩子`;
    $("browseRoleName").textContent = role.name;
    const ready = roleImage.complete && roleImage.naturalWidth > 0;
    show("browseRoleImage", ready);
    show("roleImageStatus", !ready);
    if (!ready) $("roleImageStatus").textContent = "正在加载角色图片…";
    // 角色选择依赖角色编号，不能被预览图片下载阻塞。
    $("chooseRole").disabled = false;
    roleImage.alt = role.name;
    roleImage.style.transform = `translate(${-25 * (roleIndex % 4)}%, ${-25 * Math.floor(roleIndex / 4)}%)`;
    loadRoleAtlas(true);
    $("browseRoleQuote").textContent = `「${role.quote}」`;
    $("roleCount").textContent = `${roleIndex + 1} / ${roles.length}`;
    $("previousRole").disabled = roleIndex === 0;
    $("nextRole").disabled = roleIndex === roles.length - 1;
  }
  function moveRole(delta) {
    const next = Math.max(0, Math.min(roles.length - 1, roleIndex + delta));
    if (next !== roleIndex) { roleIndex = next; renderRole(); }
  }
  function selectRole(role) {
    if (!role) return;
    selectedRole = role;
    track("role_select", { ...context(), quiz_role_id: entry?.result?.roleId });
    $("selectedRoleName").textContent = role.name;
    stage("photo");
    buttons();
  }
  async function imageBlob(path) {
    const response = await fetch(path, { headers: { "X-PT-Token": entry.token }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "图片暂时无法读取，请重试");
    }
    return response.blob();
  }
  function resetOutput() {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = null; imageLoading = false;
    avatarJpeg = null; avatarJpegRequest = null;
    $("customImage").removeAttribute("src");
    show("customOutput", false); show("saveCustomBtn", false); show("customImagePlaceholder", false);
  }
  function prepareAvatarJpeg() {
    if (avatarJpeg) return Promise.resolve(avatarJpeg);
    if (avatarJpegRequest) return avatarJpegRequest;
    const source = outputUrl;
    const request = (async () => {
      const image = $("customImage");
      if (!image.complete) await image.decode().catch(() => {});
      // 换图或重新生成时丢弃旧成品的转换结果。
      if (outputUrl !== source) throw new Error("头像已更新，请重新保存");
      const blob = await jpegBlobFromImage(image);
      if (outputUrl !== source) throw new Error("头像已更新，请重新保存");
      avatarJpeg = blob;
      return blob;
    })();
    avatarJpegRequest = request;
    request.then(
      () => { if (avatarJpegRequest === request) avatarJpegRequest = null; },
      () => { if (avatarJpegRequest === request) avatarJpegRequest = null; },
    );
    return request;
  }
  function warmAvatarJpeg() {
    // 图片出现后空闲时先转好 JPG，点击保存时就能立即打开系统面板。
    const warm = () => { void prepareAvatarJpeg().catch(() => {}); };
    if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 3000 });
    else setTimeout(warm, 600);
  }
  function resetPhotoSelection() {
    photo = null; normalized = null;
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    $("photoPreview").removeAttribute("src"); show("photoPreview", false);
    $("pickPhotoBtn").textContent = "选择宠物照片";
    $("photoConsent").checked = false;
    $("petPhoto").value = "";
    $("photoHelp").textContent = "照片短边至少 512px。上传前会压缩照片并移除元信息。";
    show("uploadPhotoBtn"); show("startFreeBtn", false);
  }
  async function loadOutput() {
    if (outputUrl) {
      $("customImage").src = outputUrl;
      show("customOutput"); show("saveCustomBtn"); show("customImagePlaceholder", false);
      warmAvatarJpeg();
      return;
    }
    if (imageLoading) return;
    imageLoading = true;
    // 先占住成品的方形位置，图片到达前也能看出正在加载。
    show("customImagePlaceholder", true);
    try {
      outputUrl = URL.createObjectURL(await imageBlob(order.imageUrl));
      $("customImage").src = outputUrl;
      show("customOutput"); show("saveCustomBtn"); show("customImagePlaceholder", false);
      warmAvatarJpeg();
    } catch (err) {
      error(err.message || "头像图片暂时无法读取，请稍后刷新重试");
    } finally { imageLoading = false; show("customImagePlaceholder", false); }
  }
  function renderRegenerateChoices() {
    const allowed = quotaAllowsRegenerate();
    show("regenerateChoices", allowed);
    $("unsatisfiedText").textContent = allowed ? TEXT.unsatisfiedWithQuota : TEXT.unsatisfiedNoQuota;
  }
  function markChoices(id, attribute, value) {
    for (const button of $(id).querySelectorAll(`[${attribute}]`)) {
      const selected = value != null && button.getAttribute(attribute) === String(value);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }
  // 四题按顺序展开：答完一题才出现下一题，换答案直接覆盖同一次记录。
  function renderSurvey() {
    if (!order?.free || order.status !== "ready") { show("surveyStep", false); return; }
    show("surveyStep");
    const data = feedback || {};
    const satisfaction = data.satisfaction ?? null;
    const satisfied = satisfaction === 2 || satisfaction === 3;
    const similarity = data.similarity ?? null;
    const priceBand = data.priceBand ?? null;
    const issue = data.issue ?? null;
    const spendHistory = data.spendHistory ?? null;
    markChoices("satisfactionChoices", "data-satisfaction", satisfaction);
    markChoices("similarityChoices", "data-similarity", similarity);
    markChoices("priceChoices", "data-price-band", priceBand);
    markChoices("issueChoices", "data-issue", issue);
    markChoices("spendChoices", "data-spend", spendHistory);
    show("similarityQuestion", satisfied);
    show("priceQuestion", satisfied && similarity !== null);
    show("issueQuestion", satisfaction === 1);
    show("spendQuestion", satisfaction !== null && (satisfied ? priceBand !== null : issue !== null));
    show("unsatisfiedGuide", satisfaction === 1);
    if (satisfaction === 1) renderRegenerateChoices();
    // 本分支的问完才收尾：满意路径要价格，不满意路径要原因。
    const complete = satisfaction !== null && spendHistory !== null && (satisfied ? priceBand !== null : issue !== null);
    $("surveyStatus").textContent = complete ? "已记录，谢谢你的反馈。" : "";
    if (surveyFocusAttempt !== order.attemptId) {
      surveyFocusAttempt = order.attemptId;
      $("surveyHeading").focus({ preventScroll: true });
    }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    const waiting = ["unlocked", "queued", "generating"].includes(order?.status);
    // 结果待确认时继续低频自动核对；回到页面时也会立即补查一次。
    const uncertain = order?.status === "uncertain";
    if (!waiting && !uncertain) return;
    if (!dialog.open || document.hidden || Date.now() - pollStart >= 600_000) return;
    pollTimer = setTimeout(() => run(checkOrder), uncertain ? 30_000 : 5000);
  }
  // 生成中只展示两个阶段：请求已发出、等待出图。完成后整块隐藏。
  function renderGenerationProgress(phase) {
    if (!phase) { show("generationProgress", false); return; }
    show("generationProgress");
    const requestState = phase === "waiting" ? "done" : "active";
    const waitState = phase === "waiting" ? "active" : "pending";
    for (const [id, state] of [["genStepRequest", requestState], ["genStepWait", waitState]]) {
      const item = $(id);
      item.dataset.state = state;
      if (state === "active") item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    }
    $("generationLive").textContent = phase === "waiting" ? "正在等待图片生成" : "正在发送生成请求";
  }
  async function renderOrder() {
    clearTimeout(pollTimer);
    progress("");
    resetOutput();
    show("retryJobBtn", false); show("tipAuthorLink", false);
    renderGenerationProgress(null);
    if (!order) return;
    const statusKey = `${order.orderId}:${order.attemptId}:${order.status}`;
    if (statusKey !== lastObservedStatus) {
      lastObservedStatus = statusKey;
      track("generation_status_observed", { ...context(), status: order.status });
    }
    // 把订单引用写进历史，历史抽屉就能找到这张照片和头像；图片仍留在云端。
    if (order.status === "ready" && order.imageUrl) {
      entry.generation = {
        orderId: order.orderId, photoId: order.photoId, roleId: order.roleId, roleName: order.roleName,
        petType: entry.petType, status: "ready", imageUrl: order.imageUrl,
        expiresAt: order.expiresAt, deliveredAt: order.deliveredAt,
      };
      saveGeneration(entry.testId, entry.generation);
    }
    if (!order.free) {
      stage("generate");
      if (order.status === "ready") {
        $("customTitle").textContent = "万圣节头像来啦";
        $("customIntro").textContent = "这份头像来自之前的付费订单，可以继续保存。";
        $("generationMessage").textContent = "头像是之前付费生成的，可以保存；免费问卷仅针对本次免费活动。";
        await loadOutput();
        if (config?.tipUrl) show("tipAuthorLink");
      } else if (order.status === "unpaid") {
        $("customTitle").textContent = "这份测评已有付款订单";
        $("generationMessage").textContent = TEXT.legacy;
      } else {
        $("generationMessage").textContent = TEXT.legacy;
      }
      return;
    }
    if (["unlocked", "queued", "generating"].includes(order.status)) {
      beginWait();
      stage("generate");
      $("customTitle").textContent = "正在生成万圣节头像";
      // 阶段文案由两步进度承担，避免同一句状态重复两遍。
      renderGenerationProgress(order.status === "generating" ? "waiting" : "sending");
      $("generationMessage").textContent = "";
      schedulePoll();
      return;
    }
    if (order.status === "ready") {
      endWait("ready");
      stage("generate");
      $("customTitle").textContent = "万圣节头像来啦";
      $("customIntro").textContent = "头像已生成，保存它的万圣节新造型。";
      $("generationMessage").textContent = "头像已生成，保存它的万圣节新造型。";
      await loadOutput();
      // 问卷不阻塞图片和保存；已有反馈时直接渲染完成态。
      renderSurvey();
      if (config?.tipUrl) show("tipAuthorLink");
      return;
    }
    if (order.status === "failed") {
      endWait("failed");
      stage("generate");
      $("customTitle").textContent = "这次生成没有完成";
      $("generationMessage").textContent = TEXT.failed;
      show("retryJobBtn", quotaAllowsRegenerate());
      return;
    }
    if (order.status === "uncertain") {
      endWait("uncertain");
      stage("generate");
      $("customTitle").textContent = "头像还在确认中";
      $("generationMessage").textContent = TEXT.uncertain;
      schedulePoll();
      return;
    }
    stage("generate");
    $("generationMessage").textContent = "正在读取生成状态…";
  }
  async function checkOrder() {
    const data = await api(`/api/free-orders?testId=${encodeURIComponent(entry.testId)}&browserId=${encodeURIComponent(ensureBrowserId())}`);
    if (data.order) order = data.order;
    if (data.free) free = data.free;
    if (data.feedback !== undefined) feedback = data.feedback;
    renderQuota(); renderQuotaNote();
    await renderOrder();
  }
  function handleOrderError(err) {
    const code = err?.code;
    track("flow_error", { ...context(), stage: "generation", error_code: code || "UNKNOWN" });
    if (code === "FREE_QUOTA_EXHAUSTED") {
      free = { ...(free || {}), exhausted: true, remaining: 0, reason: "QUOTA_EXHAUSTED" };
      error(TEXT.helpClosed);
    } else if (code === "FREE_BROWSER_LIMIT") {
      free = { ...(free || {}), browserExhausted: true, browserRemaining: 0, reason: "BROWSER_LIMIT" };
      error(TEXT.browserLimit);
    } else if (code === "SERVICE_NOT_CONFIGURED") {
      error(TEXT.serviceNotConfigured);
    } else if (code === "DELIVERY_UNAVAILABLE") {
      error(TEXT.maintenance);
    } else if (code === "LEGACY_ORDER_EXISTS" || code === "LEGACY_ORDER_PENDING") {
      order = { ...(order || {}), free: false, status: "unpaid" };
      void renderOrder();
    } else {
      error(err?.message || "连接失败，请重试");
    }
    renderQuota(); renderQuotaNote(); buttons();
  }
  async function startFreeOrder(regenerate = false) {
    if (busy) return;
    track("generation_start_click", { ...context(), is_regenerate: regenerate });
    busy = true; error(""); progress("");
    // 请求还没返回时也要让用户看到第一步在走。
    stage("generate");
    renderGenerationProgress("sending");
    $("generationMessage").textContent = "";
    show("retryJobBtn", false);
    buttons();
    try {
      const data = await api("/api/free-orders", {
        testId: entry.testId,
        photoId: photo?.photoId || order?.photoId,
        roleId: selectedRole?.id || order?.roleId || entry.result.roleId,
        browserId: ensureBrowserId(),
        // 已存在订单必须显式重试，避免把 ready/failed 当成首次创建重复扣额度。
        regenerate: Boolean(regenerate || order),
      });
      if (data.order) order = data.order;
      if (!data.idempotent) track("generation_requested", context());
      if (data.free) free = data.free;
      feedback = data.feedback ?? null;
      stage("generate");
      renderQuota(); renderQuotaNote();
      await renderOrder();
    } catch (err) {
      handleOrderError(err);
      if (!["LEGACY_ORDER_EXISTS", "LEGACY_ORDER_PENDING"].includes(err.code)) {
        renderGenerationProgress(null);
        if (["FREE_QUOTA_EXHAUSTED", "FREE_BROWSER_LIMIT", "SERVICE_NOT_CONFIGURED", "DELIVERY_UNAVAILABLE"].includes(err.code)) {
          stage("generate");
          $("customTitle").textContent = "暂时无法开始生成";
          $("generationMessage").textContent = err.message || "";
        } else {
          stage("photo");
        }
      }
    } finally {
      busy = false; buttons();
    }
  }
  async function submitFeedback(patch, focusId) {
    if (busy || !order?.attemptId) return;
    const changed = Object.entries(patch).find(([, value]) => value !== null);
    if (changed) track("survey_answer_click", { ...context(), question_id: changed[0], answer_code: changed[1] });
    busy = true; buttons();
    // 每次提交整份草稿；显式传 null 表示清空，未传的字段沿用上一次答案。
    const pick = (key) => (Object.hasOwn(patch, key) ? patch[key] : feedback?.[key] ?? null);
    const draft = {
      satisfaction: pick("satisfaction"),
      similarity: pick("similarity"),
      priceBand: pick("priceBand"),
      issue: pick("issue"),
      spendHistory: pick("spendHistory"),
    };
    try {
      const data = await api("/api/feedback", {
        testId: entry.testId, orderId: order.orderId, attemptId: order.attemptId, ...draft,
      });
      feedback = data.feedback;
      if (changed) track("survey_answer_saved", { ...context(), question_id: changed[0], answer_code: changed[1] });
      const satisfied = feedback?.satisfaction >= 2;
      const complete = feedback?.satisfaction != null && feedback?.spendHistory != null &&
        (satisfied ? feedback?.similarity != null && feedback?.priceBand != null : feedback?.issue != null);
      if (complete && !completedSurveys.has(order.attemptId)) {
        completedSurveys.add(order.attemptId);
        track("survey_complete", { ...context(), branch: satisfied ? "satisfied" : "unsatisfied" });
      }
      renderSurvey();
      if (focusId) $(focusId)?.focus({ preventScroll: true });
    } catch {
      $("surveyStatus").textContent = TEXT.feedbackFailed;
    } finally {
      busy = false; buttons();
    }
  }

  function openCustom() {
    if (pickingPhoto) return;
    if (busy) { if (!dialog.open) dialog.showModal(); return; }
    entry = getEntry();
    if (!entry) return;
    const sequence = ++opening;
    roles = []; config = null; free = null; feedback = null; order = null; regenerating = false; surveyFocusAttempt = null;
    restoring = true;
    clearTimeout(pollTimer);
    resetOutput();
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add("custom-open");
    pollStart = Date.now();
    stage("role"); show("roleChoice"); show("roleBrowser", false);
    show("surveyStep", false); show("tipAuthorLink", false);
    $("freeQuotaBadge").setAttribute("aria-expanded", "false");
    show("freeQuotaHelp", false);
    $("freeQuotaNote").textContent = "";
    $("freeQuotaBadge").dataset.state = "open";
    $("freeQuotaBadge").querySelector(".quota-badge-label").textContent = "正在查询免费额度";
    error(""); buttons();
    ensureBrowserId();
    // 先开放角色选择，再后台核对额度和历史订单，避免慢网锁住所有按钮。
    (async () => {
      roles = await loadRoles();
      if (sequence !== opening) return;
      const resultRole = roles.find((role) => role.id === entry.result.roleId);
      if (!resultRole) throw new Error("角色信息暂时无法加载，请重试");
      $("resultRoleChoice").textContent = resultRole.name;
      roleIndex = roles.findIndex((role) => role.id === resultRole.id);
      buttons();
      const id = ensureBrowserId();
      const [service, previous] = await Promise.all([
        api(`/api/config?browserId=${encodeURIComponent(id)}`),
        api(`/api/free-orders?testId=${encodeURIComponent(entry.testId)}&browserId=${encodeURIComponent(id)}`),
      ]);
      if (sequence !== opening) return;
      config = service;
      // 打赏文案跟随当前商品价（活动期 1.8 元，恢复原价后自动变 6 元）。
      const fen = Number(service.amountFen);
      if (Number.isFinite(fen) && fen > 0) $("tipPrice").textContent = String(fen / 100);
      free = previous.free || service.free || null;
      feedback = previous.feedback || null;
      const tip = $("tipAuthorLink");
      if (config.tipUrl) tip.href = config.tipUrl;
      else tip.removeAttribute("href");
      // 打赏只在有成品时出现，避免还没生成就先看到收款入口。
      show("tipAuthorLink", false);
      renderQuota(); renderQuotaNote();
      if (previous.order) {
        order = previous.order;
        if (previous.free) free = previous.free;
        await renderOrder();
      }
    })().catch((err) => { if (sequence === opening) error(err.message || "订单查询失败，请关闭后重试"); })
      .finally(() => { if (sequence === opening) { restoring = false; buttons(); } });
  }
  $("useResultRole").addEventListener("click", () => selectRole(roles.find((role) => role.id === entry.result.roleId)));
  $("browseRoles").addEventListener("click", () => { show("roleChoice", false); show("roleBrowser"); renderRole(); });
  $("backToRoleChoice").addEventListener("click", () => { show("roleBrowser", false); show("roleChoice"); });
  $("previousRole").addEventListener("click", () => moveRole(-1));
  $("nextRole").addEventListener("click", () => moveRole(1));
  $("roleSlide").addEventListener("touchstart", (event) => { touchStart = { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }; }, { passive: true });
  $("roleSlide").addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const dx = event.changedTouches[0].clientX - touchStart.x;
    const dy = event.changedTouches[0].clientY - touchStart.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) moveRole(dx < 0 ? 1 : -1);
    touchStart = null;
  }, { passive: true });
  $("chooseRole").addEventListener("click", () => selectRole(roles[roleIndex]));
  $("changeRole").addEventListener("click", () => { show("roleBrowser", false); show("roleChoice"); stage("role"); buttons(); });
  void prefetchService();
  $("customBtn").addEventListener("click", () => {
    track("generation_entry_click", { ...context(), test_id: getEntry()?.testId });
    // 全站 1000 份用完后不再进入定制流程；已经生成过头像的仍可进去查看和保存。
    if (serviceSnapshot?.free?.exhausted && !getEntry()?.generation?.orderId) { track("flow_error", { test_id: getEntry()?.testId, stage: "entry", error_code: "FREE_QUOTA_EXHAUSTED" }); openQuotaClosed(); return; }
    openCustom();
  });
  $("closeQuotaClosed").addEventListener("click", () => $("quotaClosedDialog").close());
  $("quotaClosedDialog").addEventListener("close", () => $("customBtn").focus({ preventScroll: true }));
  window.addEventListener("pagehide", () => { endWait("navigation"); clearTimeout(pollTimer); });
  $("closeCustomBtn").addEventListener("click", () => dialog.close());
  $("freeQuotaBadge").addEventListener("click", () => {
    const expanded = $("freeQuotaBadge").getAttribute("aria-expanded") === "true";
    $("freeQuotaBadge").setAttribute("aria-expanded", String(!expanded));
    show("freeQuotaHelp", !expanded);
  });
  dialog.addEventListener("close", () => {
    endWait("dialog_closed");
    document.documentElement.classList.remove("custom-open");
    clearTimeout(pollTimer);
    $("customBtn").focus({ preventScroll: true });
  });
  $("pickPhotoBtn").addEventListener("click", () => { track("photo_pick_open", context()); pickingPhoto = true; $("petPhoto").click(); });
  $("petPhoto").addEventListener("cancel", () => { pickingPhoto = false; });
  $("photoConsent").addEventListener("change", buttons);
  $("petPhoto").addEventListener("change", () => run(async () => {
    pickingPhoto = false;
    const file = $("petPhoto").files?.[0];
    if (!file) return;
    track("photo_selected", context());
    normalized = null; photo = null;
    show("startFreeBtn", false);
    show("photoPreview", false); show("uploadPhotoBtn");
    $("uploadPhotoBtn").textContent = "上传这张照片";
    $("photoHelp").textContent = "照片短边至少 512px。上传前会压缩照片并移除元信息。";
    if (file.size > 10 * 1024 * 1024) throw new Error("原图不能超过 10MB，请选择小一点的照片");
    progress("正在读取照片…");
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    try {
      await image.decode().catch(() => { throw new Error("无法读取这张照片，请换成 JPG、PNG、WebP 或截图"); });
      if (Math.min(image.naturalWidth, image.naturalHeight) < 512) throw new Error("照片太小，请选择短边至少 512px 的清晰照片");
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
      if (Math.min(canvas.width, canvas.height) < 512) throw new Error("照片过于狭长，请裁切后重新选择");
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      // 保留像素尺寸，优先把照片编码到约800KB；复杂纹理不继续强压，仍受2MB硬上限约束。
      for (const quality of [0.88, 0.82, 0.76, 0.7]) {
        normalized = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (normalized && normalized.size <= 800 * 1024) break;
      }
      if (!normalized || normalized.size > 2 * 1024 * 1024) { normalized = null; throw new Error("照片压缩后仍超过 2MB，请换一张照片"); }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(normalized);
      $("photoPreview").src = previewUrl; show("photoPreview");
      $("pickPhotoBtn").textContent = "换一张照片";
      $("photoHelp").textContent = `已处理为 ${canvas.width} × ${canvas.height} 像素，约 ${Math.ceil(normalized.size / 1024)} KB。上传前已移除原图元信息。`;
      show("uploadPhotoBtn");
    } finally { URL.revokeObjectURL(url); $("petPhoto").value = ""; progress(""); }
  }));
  $("uploadPhotoBtn").addEventListener("click", () => run(async () => {
    track("photo_upload_start", context());
    progress("正在上传照片…");
    const form = new FormData();
    form.set("testId", entry.testId); form.set("token", entry.token); form.set("consent", String($("photoConsent").checked));
    form.set("photo", normalized, "pet.jpg");
    try { photo = await uploadPhoto(form); }
    catch (err) { track("flow_error", { ...context(), stage: "upload", error_code: err.code || "UPLOAD_FAILED" }); $("uploadPhotoBtn").textContent = "重新上传这张照片"; throw err; }
    track("photo_upload_succeeded", context());
    progress("");
    show("uploadPhotoBtn", false); show("startFreeBtn");
    $("photoHelp").textContent = config?.available
      ? "照片上传完成。点击「免费生成头像」开始生成。"
      : "照片上传完成。免费生图通道暂不可用，已选择的照片和角色会保留。";
    renderQuotaNote(); buttons();
  }));
  $("startFreeBtn").addEventListener("click", () => startFreeOrder(regenerating));
  $("retryJobBtn").addEventListener("click", () => { regenerating = true; startFreeOrder(true); });
  $("satisfactionChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-satisfaction]");
    if (!button) return;
    const satisfaction = Number(button.dataset.satisfaction);
    // 换到另一条分支时显式清空那一侧的答案，避免提交互相矛盾的组合。
    const patch = satisfaction === 1 ? { satisfaction, similarity: null, priceBand: null } : { satisfaction, issue: null };
    submitFeedback(patch, satisfaction === 1 ? "issueHeading" : "similarityHeading");
  });
  $("similarityChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-similarity]");
    if (!button) return;
    submitFeedback({ similarity: Number(button.dataset.similarity) }, "priceHeading");
  });
  $("priceChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-price-band]");
    if (!button) return;
    submitFeedback({ priceBand: button.dataset.priceBand }, "spendHeading");
  });
  $("issueChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-issue]");
    if (!button) return;
    submitFeedback({ issue: button.dataset.issue }, "spendHeading");
  });
  $("spendChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-spend]");
    if (!button) return;
    submitFeedback({ spendHistory: Number(button.dataset.spend) });
  });
  $("regenerateRoleBtn").addEventListener("click", () => {
    regenerating = true;
    selectedRole = null;
    show("roleBrowser", false); show("roleChoice");
    stage("role");
    buttons();
  });
  $("regeneratePhotoBtn").addEventListener("click", () => {
    regenerating = true;
    resetPhotoSelection();
    stage("photo");
    buttons();
  });
  $("viewCustomLink").addEventListener("click", (event) => {
    event.preventDefault();
    if (!outputUrl) return;
    openViewer?.(outputUrl, "万圣节头像大图", "毛孩子的万圣节头像", $("viewCustomLink"));
  });
  $("saveCustomBtn").addEventListener("click", () => run(async () => {
    if (!outputUrl) return;
    track("image_save_click", context());
    const button = $("saveCustomBtn");
    button.disabled = true;
    // 已预编码时保持同步执行，iOS 才能在点击手势内直接打开系统面板。
    if (!avatarJpeg) button.textContent = "正在生成 JPG…";
    try {
      const blob = avatarJpeg || await prepareAvatarJpeg();
      const filename = `PETI-${entry.petName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "")}-万圣节头像.jpg`;
      // 手机上用系统面板直接「存储图像」进相册，整个过程留在当前页面。
      const outcome = await shareOrDownload(blob, filename, "毛孩子的万圣节头像");
      button.textContent = {
        shared: "已打开保存面板",
        downloaded: "已保存 JPG，再次保存",
        wechat: "请长按上方头像保存",
        cancelled: "保存头像",
      }[outcome];
    } finally {
      button.disabled = false;
      if (button.textContent === "正在生成 JPG…") button.textContent = "保存头像";
    }
  }));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { endWait("page_hidden"); clearTimeout(pollTimer); }
    else if (!pickingPhoto && dialog.open && ["unlocked", "queued", "generating", "uncertain"].includes(order?.status) && !busy) { beginWait(); run(checkOrder); }
  });
}
