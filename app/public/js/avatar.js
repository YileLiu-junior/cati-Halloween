import { initAvatarSupport, refundLocked, imageWithheld } from "./avatar-support.js";
import { imageHost, jpegFromUrl, previewUrl, shareOrDownload } from "./save-image.js";
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const id = params.get("order"), token = params.get("access");
// 凭证留在当前标签页中，移出地址栏，避免被复制到其他页面。
if (id && token) {
  sessionStorage.setItem(`peti:avatar:${id}`, token);
  history.replaceState(null, "", `${location.pathname}#order=${encodeURIComponent(id)}`);
}
const access = token || sessionStorage.getItem(`peti:avatar:${id}`);
let order, busy = false, saving = false, timer, outputUrl, hdJpeg = null;
const show = (name, value = true) => $(name).classList.toggle("hidden", !value);
const error = message => { $("avatarError").textContent = message; show("avatarError", Boolean(message)); };
const avatarName = () => `PETI-${(order?.petName || "宠物").replace(/[<>:"/\\|?*\x00-\x1f]/g, "")}-万圣节头像.jpg`;
async function api(path, body) {
  const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", headers: body ? { "content-type": "application/json" } : { "X-PT-Token": access }, body: body ? JSON.stringify({ ...body, token: access }) : undefined, signal: AbortSignal.timeout(30_000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || "暂时无法读取订单，请稍后刷新");
  return data;
}
const support = initAvatarSupport(api, () => order, refresh, error);
async function refresh() {
  clearTimeout(timer);
  if (busy) return;
  busy = true; $("refreshAvatar").disabled = true; error("");
  try {
    if (!id || !access) throw new Error("请从爱发电私信中的专属链接进入，或返回原浏览器查看订单。");
    order = await api(`/api/checkout/${encodeURIComponent(id)}`);
    show("avatarEnvironment", Boolean(order.testMode));
    show("avatarOrder");
    $("avatarPet").textContent = `${order.petName || "毛孩子"}的万圣节头像`;
    $("avatarAmount").textContent = order.testMode ? `模拟金额 ¥${(order.amountFen / 100).toFixed(2)}（无真实扣款）` : `定制金额 ¥${(order.amountFen / 100).toFixed(2)}`;
    $("avatarReference").textContent = order.payId;
    const messages = { unpaid: "付款还在核对中，请勿重复付款。", unlocked: "付款已确认，正在安排后台生成。", queued: "付款已确认，头像已排队。", generating: "正在生成头像，通常需要几十秒至几分钟。关掉页面也会继续。", ready: "头像来啦！请在 7 天内保存。", failed: "头像生成失败，可以在下方申请退款。", uncertain: "生成结果暂未确认，已记录异常。可继续查询或申请退款。" };
    $("avatarMessage").textContent = refundLocked(order) ? "退款申请处理中，新的生成与重试已暂停；审核期间已生成的头像仍可保存。处理进度见下方。" : messages[order.status] || "订单状态已更新。";
    if (order.refundStatus === "refunded") $("avatarMessage").textContent = "这笔退款已完成，处理凭证见下方。";
    show("avatarOutput", false); show("downloadAvatar", false);
    if (order.imageUrl && !imageWithheld(order)) {
      if (!outputUrl) {
        // 页面只下载压缩预览；保存时再取高清原图。
        const response = await fetch(previewUrl(order.imageUrl), { headers: { "X-PT-Token": access }, cache: "default", signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error((await response.json()).message || "头像暂时无法读取");
        outputUrl = URL.createObjectURL(await response.blob());
        hdJpeg = null;
      }
      $("avatarImage").src = outputUrl; $("downloadAvatar").href = outputUrl;
      $("downloadAvatar").download = avatarName();
      show("avatarOutput"); show("downloadAvatar");
    }
    await support();
  } catch (err) { error(err.message || "连接中断，请稍后刷新"); }
  finally {
    busy = false; $("refreshAvatar").disabled = false;
    if (order && !document.hidden && (["unpaid", "unlocked", "queued", "generating", "uncertain"].includes(order.status) || refundLocked(order))) timer = setTimeout(refresh, 10_000);
  }
}
$("refreshAvatar").addEventListener("click", refresh);
$("downloadAvatar").addEventListener("click", async (event) => {
  event.preventDefault();
  if (!outputUrl || saving) return;
  saving = true;
  try {
    if (!hdJpeg) $("avatarMessage").textContent = "正在准备高清原图…";
    if (!hdJpeg) hdJpeg = await jpegFromUrl(order.imageUrl, access);
    const blob = hdJpeg;
    const outcome = await shareOrDownload(blob, avatarName(), "毛孩子的万圣节头像", {
      host: imageHost({ orderId: id, orderToken: access }),
      target: $("avatarImage"),
    });
    $("avatarMessage").textContent = {
      shared: "已打开保存面板，选择“存储图像”即可存入相册。",
      downloaded: "已保存 JPG，可在相册或下载中查看。",
      wechat: "微信里请长按头像保存到手机。",
      cancelled: "",
    }[outcome] || $("avatarMessage").textContent;
  } catch {
    $("avatarMessage").textContent = "保存失败，请长按头像保存。";
  } finally {
    saving = false;
  }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else refresh(); });
window.addEventListener("pagehide", () => clearTimeout(timer));
refresh();
