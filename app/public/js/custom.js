const $ = (id) => document.getElementById(id);
const show = (id, visible = true) => $(id).classList.toggle("hidden", !visible);
const yuan = (fen) => String(fen / 100);

export function initCustom(getEntry) {
  const dialog = $("customDialog");
  let entry, photo, order, config, normalized, previewUrl, outputUrl;
  let busy = false, pollTimer, pollStart, imageLoading = false;

  function error(message) { $("customError").textContent = message; show("customError", Boolean(message)); }
  function progress(message) { $("customProgress").textContent = message; }
  function buttons() {
    $("uploadPhotoBtn").disabled = busy || !normalized || !$("photoConsent").checked;
    $("generatePaidBtn").disabled = busy || !photo || !$("photoConsent").checked;
    $("petPhoto").disabled = busy;
    $("photoConsent").disabled = busy;
    $("confirmPaymentBtn").disabled = busy;
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
    const response = await fetch(path, {
      method: body ? "POST" : "GET", cache: "no-store",
      headers: body instanceof FormData ? {} : body ? { "content-type": "application/json" } : { "X-PT-Token": entry.token },
      body: body instanceof FormData ? body : body ? JSON.stringify({ ...body, token: entry.token }) : undefined,
      signal: AbortSignal.timeout(190_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "请求未完成，请稍后重试");
    return data;
  }
  function stage(name) {
    show("photoStep", name === "photo"); show("paymentStep", name === "payment"); show("generationStep", name === "generate");
    for (const [key, id] of [["photo", "stepPhoto"], ["payment", "stepPayment"], ["generate", "stepGenerate"]]) {
      if (key === name) $(id).setAttribute("aria-current", "step"); else $(id).removeAttribute("aria-current");
    }
    $("customTitle").textContent = { photo: "先选一张它的照片", payment: "照片就绪，去定制它", generate: "它的盲盒正在揭晓" }[name];
    $("customIntro").textContent = { photo: "正脸清楚、毛色完整，尽量只有一只毛孩子。", payment: "付款核对成功后，自动开始生成。", generate: "每单生成一个形象，不用重复付款。" }[name];
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
    if (!dialog.open || document.hidden || Date.now() - pollStart >= 600_000) { show("checkJobBtn"); return; }
    pollTimer = setTimeout(() => run(checkOrder), 5000);
  }
  async function renderOrder() {
    clearTimeout(pollTimer);
    progress("");
    if (order.status === "unpaid") {
      stage("payment");
      $("paymentAmount").textContent = `${yuan(order.amountFen)} 元 · 1 个定制盲盒`;
      $("paymentReference").textContent = order.payId;
      const available = config?.available && order.amountFen === config.amountFen && new Date(order.expiresAt).getTime() > Date.now();
      show("payLink", Boolean(available && order.payUrl));
      if (available && order.payUrl) $("payLink").href = order.payUrl;
      else progress("付款链接暂不可用。如已付款，请填写订单号核对，请勿重复付款。");
      return;
    }
    stage("generate");
    show("retryJobBtn", order.status === "unlocked" || (order.status === "failed" && order.retryable));
    show("checkJobBtn", order.status === "generating" || order.status === "uncertain" || order.status === "ready");
    if (order.status === "ready") {
      $("customTitle").textContent = "毛孩子的盲盒来啦";
      $("generationMessage").textContent = "定制完成，保存这份万圣节新造型。";
      if (!outputUrl && !imageLoading) {
        imageLoading = true;
        try {
          outputUrl = URL.createObjectURL(await imageBlob(order.imageUrl));
          $("customImage").src = outputUrl;
          show("customOutput"); show("saveCustomBtn"); show("checkJobBtn", false);
        } finally { imageLoading = false; }
      }
    } else if (order.status === "generating") {
      $("generationMessage").textContent = "正在为毛孩子制作新造型，通常需要几分钟。请保持此页打开。";
      schedulePoll();
    } else if (order.status === "uncertain") {
      $("generationMessage").textContent = "生成结果暂未确认。请查询进度，或保存订单号联系作者，请勿重复付款或重新生成。";
    } else if (order.status === "unlocked") {
      $("generationMessage").textContent = "付款已确认，可以继续生成。";
      $("retryJobBtn").textContent = "开始生成定制盲盒";
    } else {
      $("generationMessage").textContent = order.retryable ? "这次生成未完成，付款权益已保留，可以重试一次。" : "生成未完成。请保存订单号联系作者核对，请勿重复付款。";
      $("retryJobBtn").textContent = "重试生成";
    }
  }
  async function checkOrder() {
    order = await api(`/api/checkout/${order.payId}`);
    await renderOrder();
  }
  async function startGeneration() {
    progress("");
    stage("generate");
    $("generationMessage").textContent = "正在为毛孩子制作新造型，通常需要几分钟。请保持此页打开。";
    show("retryJobBtn", false);
    try { order = await api("/api/jobs", { payId: order.payId }); }
    catch (err) {
      show("checkJobBtn");
      $("generationMessage").textContent = "连接暂时中断，请先查询生成结果，请勿重复付款。";
      throw err;
    }
    await renderOrder();
  }

  $("customBtn").addEventListener("click", () => {
    if (busy) { dialog.showModal(); return; }
    entry = getEntry();
    if (!entry) return;
    dialog.showModal();
    pollStart = Date.now();
    run(async () => {
      config = await api("/api/config");
      $("generatePaidBtn").textContent = `${yuan(config.amountFen)}元生成定制盲盒`;
      show("customAvailability", !config.available);
      const previous = await api(`/api/checkout?testId=${encodeURIComponent(entry.testId)}`);
      if (previous.order) {
        order = previous.order;
        if (order.status === "unpaid" && config.available) order = { ...order, ...(await api("/api/checkout", { testId: entry.testId, photoId: order.photoId })) };
        await renderOrder();
      } else stage("photo");
    });
  });
  $("closeCustomBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { clearTimeout(pollTimer); $("customBtn").focus({ preventScroll: true }); });
  $("photoConsent").addEventListener("change", buttons);
  $("petPhoto").addEventListener("change", () => run(async () => {
    const file = $("petPhoto").files?.[0];
    if (!file) return;
    normalized = null; photo = null; show("generatePaidBtn", false);
    show("photoPreview", false); show("uploadPhotoBtn");
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
      for (const quality of [0.9, 0.75, 0.6]) {
        normalized = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (normalized && normalized.size <= 2 * 1024 * 1024) break;
      }
      if (!normalized || normalized.size > 2 * 1024 * 1024) { normalized = null; throw new Error("照片压缩后仍超过 2MB，请换一张照片"); }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(normalized);
      $("photoPreview").src = previewUrl; show("photoPreview");
      $("photoLabel").firstChild.textContent = "换一张照片";
      show("uploadPhotoBtn");
    } finally { URL.revokeObjectURL(url); $("petPhoto").value = ""; progress(""); }
  }));
  $("uploadPhotoBtn").addEventListener("click", () => run(async () => {
    progress("正在上传照片…");
    const form = new FormData();
    form.set("testId", entry.testId); form.set("token", entry.token); form.set("consent", String($("photoConsent").checked));
    form.set("photo", normalized, "pet.jpg");
    photo = await api("/api/photos", form);
    progress("");
    show("uploadPhotoBtn", false); show("generatePaidBtn");
    $("photoHelp").textContent = "照片上传完成。确认后前往付款，核对成功即开始生成。";
  }));
  $("generatePaidBtn").addEventListener("click", () => run(async () => {
    progress("正在准备支付…");
    order = await api("/api/checkout", { testId: entry.testId, photoId: photo.photoId });
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
  $("saveCustomBtn").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = outputUrl; link.download = `喵灵万圣节-${entry.petName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "")}-定制盲盒.png`;
    link.click(); $("saveCustomBtn").textContent = "已发起保存，再次保存";
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && dialog.open && order?.status === "generating" && !busy) run(checkOrder); });
}
