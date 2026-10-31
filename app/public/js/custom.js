import { roleAtlasUrl } from "./role-assets.js";
import { fetchQuiz } from "./store.js";
import { initAvatarSupport, refundLocked, imageWithheld } from "./avatar-support.js";

const $ = (id) => document.getElementById(id);
const show = (id, visible = true) => $(id).classList.toggle("hidden", !visible);
const yuan = (fen) => String(fen / 100);

export function initCustom(getEntry) {
  const dialog = $("customDialog");
  let entry, photo, order, config, normalized, previewUrl, outputUrl, roles = [], selectedRole, roleIndex = 0, touchStart;
  let busy = false, pollTimer, pollStart, imageLoading = false;
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
  function buttons() {
    $("useResultRole").disabled = busy || !roles.length;
    $("browseRoles").disabled = busy || !roles.length;
    $("uploadPhotoBtn").disabled = busy || restoring || !normalized || !$("photoConsent").checked;
    $("generatePaidBtn").disabled = busy || restoring || !config?.available || !photo || !$("photoConsent").checked;
    $("petPhoto").disabled = busy;
    $("pickPhotoBtn").disabled = busy;
    $("photoConsent").disabled = busy;
    $("confirmPaymentBtn").disabled = busy;
    $("checkPaymentBtn").disabled = busy;
    $("retryJobBtn").disabled = busy;
    $("checkJobBtn").disabled = busy;
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
    if (!response.ok || !data) throw new Error(data?.message || "服务暂时没有返回有效结果，请稍后重试");
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
    show("roleStep", name === "role"); show("photoStep", name === "photo"); show("paymentStep", name === "payment"); show("generationStep", name === "generate");
    for (const [key, id] of [["role", "stepRole"], ["photo", "stepPhoto"], ["payment", "stepPayment"], ["generate", "stepGenerate"]]) {
      if (key === name) $(id).setAttribute("aria-current", "step"); else $(id).removeAttribute("aria-current");
    }
    $("customTitle").textContent = { role: "想让它扮演谁？", photo: "选一张它的照片", payment: "确认这次定制", generate: "正在生成万圣节头像" }[name];
    $("customIntro").textContent = { role: "用测出的角色，或挑选一个喜欢的造型。", photo: "正脸清楚、毛色完整，尽量只有一只毛孩子。", payment: "付款核对成功后，自动开始生成。", generate: "头像会在后台继续生成，不用保持页面打开或重复付款。" }[name];
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
    $("selectedRoleName").textContent = role.name;
    stage("photo");
  }
  async function imageBlob(path) {
    const response = await fetch(path, { headers: { "X-PT-Token": entry.token }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "图片暂时无法读取，请重试");
    }
    return response.blob();
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!dialog.open || document.hidden || Date.now() - pollStart >= 600_000) { show(order.status === "unpaid" ? "checkPaymentBtn" : "checkJobBtn"); return; }
    pollTimer = setTimeout(() => run(checkOrder), 5000);
  }
  async function renderOrder() {
    clearTimeout(pollTimer);
    progress("");
    show("customOutput", false); show("saveCustomBtn", false);
    await renderSupport();
    // 批准退款后才收回成品；审核期间已生成的头像继续展示。
    if (imageWithheld(order)) {
      stage("generate");
      $("customTitle").textContent = order.refundStatus === "refunded" ? "退款已完成" : "退款申请处理中";
      $("generationMessage").textContent = "新的生成与重试已暂停。审核结果会在下方更新，也会尝试发送至付款账号。";
      show("retryJobBtn", false); show("checkJobBtn"); schedulePoll(); return;
    }
    if (refundLocked(order) && order.status !== "ready") {
      stage("generate");
      $("customTitle").textContent = "退款申请处理中";
      $("generationMessage").textContent = "新的生成与重试已暂停。审核结果会在下方更新，也会尝试发送至付款账号。";
      show("retryJobBtn", false); show("checkJobBtn"); schedulePoll(); return;
    }
    if (order.status === "unpaid") {
      stage("payment");
      $("paymentRoleName").textContent = roles.find((role) => role.id === order.roleId)?.name || entry.result.roleName;
      $("paymentAmount").textContent = `${yuan(order.amountFen)} 元 · 1 个万圣节头像`;
      $("paymentReference").textContent = order.payId;
      const available = config?.available && order.amountFen === config.amountFen && new Date(order.expiresAt).getTime() > Date.now();
      show("payLink", Boolean(available && order.payUrl && !config?.testMode));
      if (available && order.payUrl && !config?.testMode) $("payLink").href = order.payUrl;
      else progress(config?.testMode ? "测试环境不收款。等待测试管理员模拟确认后，自动开始生成。" : "付款链接暂不可用。如已付款，请填写订单号核对，请勿重复付款。");
      if (config?.testMode) {
        $("paymentAmount").textContent = "测试订单 · 无需真实付款";
        $("customIntro").textContent = "这是独立测试环境，付款确认由测试管理员模拟。";
        $("paymentInstructions").textContent = "此处不会跳转爱发电，不发生真实收款。测试通知只保存在测试记录中。";
        $("platformOrderNo").closest("details").classList.add("hidden");
      }
      schedulePoll();
      return;
    }
    if (order.status === "unlocked") { await startGeneration(); return; }
    stage("generate");
    show("retryJobBtn", order.status === "failed" && order.retryable);
    show("checkJobBtn", ["queued", "generating", "uncertain", "ready"].includes(order.status));
    if (order.status === "ready") {
      $("customTitle").textContent = "万圣节头像来啦";
      sessionStorage.removeItem("peti:payment");
      $("generationMessage").textContent = "头像已生成，保存它的万圣节新造型。";
      if (outputUrl) { show("customOutput"); show("saveCustomBtn"); show("checkJobBtn", false); }
      if (!outputUrl && !imageLoading) {
        imageLoading = true;
        try {
          outputUrl = URL.createObjectURL(await imageBlob(order.imageUrl));
          $("customImage").src = outputUrl;
          show("customOutput"); show("saveCustomBtn"); show("checkJobBtn", false);
        } finally { imageLoading = false; }
      }
    } else if (["queued", "generating"].includes(order.status)) {
      $("generationMessage").textContent = order.status === "queued" ? "付款已确认，头像已排队。生成完成后会向付款账号发送领取入口。" : "正在制作它的万圣节头像，通常需要几十秒至几分钟。离开页面也会继续生成。";
      schedulePoll();
    } else if (order.status === "uncertain") {
      $("generationMessage").textContent = "生成结果暂未确认，系统已记录异常。请查询进度或在下方申请退款，无需重新付款。";
      schedulePoll();
    } else {
      $("generationMessage").textContent = order.retryable ? "这次生成未完成，付款权益已保留，可以重试一次，也可申请退款。" : "生成未完成，可以在下方申请退款。请勿重复付款。";
      $("retryJobBtn").textContent = "重试生成";
    }
  }
  async function checkOrder() {
    // 查单只返回状态字段；保留创建订单时取得的付款链接，避免轮询把未付款入口清掉。
    order = { ...order, ...(await api(`/api/checkout/${order.payId}`)) };
    await renderOrder();
  }
  const renderSupport = initAvatarSupport(api, () => order, checkOrder, error);
  async function startGeneration() {
    progress("");
    stage("generate");
    $("generationMessage").textContent = "正在制作它的万圣节头像，通常需要几十秒至几分钟。离开页面也会继续生成。";
    show("retryJobBtn", false);
    try { order = await api("/api/jobs", { payId: order.payId }); }
    catch (err) {
      show("checkJobBtn");
      $("generationMessage").textContent = "连接暂时中断，请先查询生成结果，请勿重复付款。";
      throw err;
    }
    await renderOrder();
  }

  function openCustom() {
    if (pickingPhoto) return;
    if (busy) { if (!dialog.open) dialog.showModal(); return; }
    entry = getEntry();
    if (!entry) return;
    const sequence = ++opening;
    roles = []; config = null; restoring = true;
    show("refundSection", false);
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add("custom-open");
    pollStart = Date.now();
    stage("role"); show("roleChoice"); show("roleBrowser", false); error(""); buttons();
    // 先开放角色选择，再后台核对服务和历史订单，避免慢网锁住所有按钮。
    (async () => {
      roles = await loadRoles();
      if (sequence !== opening) return;
      const resultRole = roles.find((role) => role.id === entry.result.roleId);
      if (!resultRole) throw new Error("角色信息暂时无法加载，请重试");
      $("resultRoleChoice").textContent = resultRole.name;
      roleIndex = roles.findIndex((role) => role.id === resultRole.id);
      buttons();
      $("generatePaidBtn").textContent = "下一步：确认付款";
      const [service, previous] = await Promise.all([api("/api/config"), api(`/api/checkout?testId=${encodeURIComponent(entry.testId)}`)]);
      if (sequence !== opening) return;
      config = service;
      if (config.testMode) {
        dialog.querySelector(".custom-kicker").textContent = "独立测试环境 · 不收款";
        $("generatePaidBtn").textContent = "下一步：创建测试订单";
      }
      show("customAvailability", !config.available);
      if (previous.order) {
        order = previous.order;
        if (order.status === "unpaid" && config.available) order = { ...order, ...(await api("/api/checkout", { testId: entry.testId, photoId: order.photoId, roleId: order.roleId || entry.result.roleId })) };
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
  $("changeRole").addEventListener("click", () => { show("roleBrowser", false); show("roleChoice"); stage("role"); });
  $("customBtn").addEventListener("click", openCustom);
  window.addEventListener("pageshow", () => {
    if (sessionStorage.getItem("peti:payment") === getEntry()?.testId) openCustom();
  });
  window.addEventListener("pagehide", () => clearTimeout(pollTimer));
  $("closeCustomBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { document.documentElement.classList.remove("custom-open"); clearTimeout(pollTimer); $("customBtn").focus({ preventScroll: true }); });
  $("pickPhotoBtn").addEventListener("click", () => { pickingPhoto = true; $("petPhoto").click(); });
  $("petPhoto").addEventListener("cancel", () => { pickingPhoto = false; });
  $("photoConsent").addEventListener("change", buttons);
  $("petPhoto").addEventListener("change", () => run(async () => {
    pickingPhoto = false;
    const file = $("petPhoto").files?.[0];
    if (!file) return;
    normalized = null; photo = null; show("generatePaidBtn", false);
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
    progress("正在上传照片…");
    const form = new FormData();
    form.set("testId", entry.testId); form.set("token", entry.token); form.set("consent", String($("photoConsent").checked));
    form.set("photo", normalized, "pet.jpg");
    try { photo = await uploadPhoto(form); }
    catch (err) { $("uploadPhotoBtn").textContent = "重新上传这张照片"; throw err; }
    progress("");
    show("uploadPhotoBtn", false); show("generatePaidBtn");
    $("photoHelp").textContent = config?.testMode ? "照片上传完成。下一步创建测试订单，无需真实付款。" : config?.available ? "照片上传完成。确认后前往付款，核对成功即开始生成。" : "照片上传完成。付费定制暂未开放，当前不会扣款。";
  }));
  $("generatePaidBtn").addEventListener("click", () => run(async () => {
    progress("正在准备支付…");
    order = await api("/api/checkout", { testId: entry.testId, photoId: photo.photoId, roleId: selectedRole.id });
    await renderOrder();
  }));
  $("copyPaymentBtn").addEventListener("click", () => run(async () => {
    try { await navigator.clipboard.writeText(order.payId); $("copyPaymentBtn").textContent = "已复制"; }
    catch { throw new Error("复制失败，请长按上方支付标识复制"); }
  }));
  $("confirmPaymentBtn").addEventListener("click", () => run(async () => {
    progress("正在核对付款，请勿重复付款…");
    order = await api(`/api/checkout/${order.payId}/confirm`, { platformOrderNo: $("platformOrderNo").value.trim() });
    if (order.status === "unlocked") await startGeneration(); else await renderOrder();
  }));
  $("retryJobBtn").addEventListener("click", () => run(startGeneration));
  $("checkJobBtn").addEventListener("click", () => { pollStart = Date.now(); run(checkOrder); });
  $("checkPaymentBtn").addEventListener("click", () => { pollStart = Date.now(); run(checkOrder); });
  $("payLink").addEventListener("click", () => sessionStorage.setItem("peti:payment", entry.testId));
  $("saveCustomBtn").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = outputUrl; link.download = `PETI-${entry.petName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "")}-万圣节头像.png`;
    link.click(); $("saveCustomBtn").textContent = "已发起保存，再次保存";
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(pollTimer);
    else if (!pickingPhoto && dialog.open && ["unpaid", "unlocked", "queued", "generating", "uncertain"].includes(order?.status) && !busy) run(checkOrder);
  });
}
