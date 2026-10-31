const $ = id => document.getElementById(id);
let secret = "", data;
const labels = { unpaid: "待付款", unlocked: "已付待入队", queued: "已排队", generating: "生成中", ready: "已交付", failed: "生成失败", uncertain: "结果待核对", none: "无", pending: "待审核", needs_info: "待补充", approved: "已批准", processing: "退款中", refunded: "已退款", rejected: "已驳回", withdrawn: "用户已撤回" };
const reasons = { not_delivered: "未收到头像", generation_failed: "生成失败", duplicate_payment: "重复付款", image_quality: "图片问题", payment_unconfirmed: "付款未识别" };
const label = value => labels[value] || value;
const message = text => { $("adminStatus").textContent = text; };
function error(text = "") { $("adminError").textContent = text; $("adminError").classList.toggle("hidden", !text); }
async function api(path, body) {
  const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "请求失败");
  return result;
}
async function run(action) { error(); try { await action(); } catch (err) { error(err.message); } }
function detail() {
  const refund = data.refunds.find(row => row.id === $("reviewId").value);
  $("refundDetail").textContent = refund ? `订单 ${refund.order_id}｜${label(refund.state)}｜¥${(refund.amount_fen / 100).toFixed(2)}｜原因 ${reasons[refund.reason] || refund.reason}｜说明 ${refund.details || "无"}｜联系方式 ${refund.contact || "未提供"}｜审核记录 ${refund.review_note || "无"}` : "暂无申请";
  $("reviewAmount").value = refund ? (refund.amount_fen / 100).toFixed(2) : "";
  const transaction = refund && data.transactions?.find(row => row.order_id === refund.order_id && (refund.trade_no ? row.trade_no === refund.trade_no : row.state === "paid"));
  if (refund) $("refundDetail").textContent += transaction ? `｜已核实交易 ${transaction.trade_no}，¥${(transaction.amount_fen / 100).toFixed(2)}，${transaction.state === "refunded" ? "已登记退款" : "付款已确认"}` : "｜尚无已核实付款，请先核实付款后批准退款";
  $("reviewSubmit").disabled = !refund || ["refunded", "rejected", "withdrawn"].includes(refund.state);
  $("adminImages").replaceChildren(); $("adminImages").classList.add("hidden");
}
async function refresh() {
  data = await api("/api/admin/avatar-orders");
  $("adminContent").classList.remove("hidden"); $("adminLogin").classList.add("hidden");
  const stale = data.deliveryActive === false || !data.heartbeatAt || Date.now() - data.heartbeatAt > 300_000;
  message(stale ? "后台生成服务未就绪，已暂停创建收费订单。" : `后台服务正常，最近检查：${new Date(data.heartbeatAt).toLocaleString()}`);
  if (data.testMode) message(`独立测试环境 · 不发生真实收款或退款。${$("adminStatus").textContent}`);
  const previous = $("reviewId").value;
  $("reviewId").replaceChildren(...data.refunds.map(row => new Option(`${label(row.state)} · ¥${(row.amount_fen / 100).toFixed(2)} · ${row.order_id}`, row.id)));
  if (data.refunds.some(row => row.id === previous)) $("reviewId").value = previous;
  detail(); $("adminOrders").replaceChildren();
  for (const order of data.orders) {
    const tr = document.createElement("tr");
    for (const text of [order.id, label(order.status), `¥${(order.amount_fen / 100).toFixed(2)}`, label(order.refund_status)]) { const td = document.createElement("td"); td.textContent = text; tr.append(td); }
    const td = document.createElement("td"); const button = document.createElement("button"); button.className = "text-button"; button.textContent = "核实付款";
    button.textContent = data.testMode ? "模拟确认测试付款" : "核实付款";
    button.addEventListener("click", () => run(async () => {
      if (data.testMode) { await api(`/api/admin/avatar-orders/${order.id}`, { action: "confirm_test_payment" }); await refresh(); return; }
      const tradeNo = prompt("请输入需要核实的爱发电订单号；核对额外付款时请替换为那笔交易", order.platform_order_no || "");
      if (!tradeNo) return;
      await api(`/api/admin/avatar-orders/${order.id}`, { action: "verify_payment", tradeNo }); await refresh();
    })); td.append(button); tr.append(td); $("adminOrders").append(tr);
  }
  $("adminNotifications").replaceChildren();
  for (const notice of data.notifications) {
    const p = document.createElement("p"); p.textContent = `订单 ${notice.order_id} · ${notice.event} · ${notice.state === "sending" ? "发送中" : "发送结果待核对"}`;
    if (notice.state === "uncertain") {
      const button = document.createElement("button"); button.className = "text-button"; button.textContent = "已核实未发送，补发提醒";
      button.addEventListener("click", () => run(async () => {
        if (!confirm("确认已检查爱发电私信，且这条提醒没有发送成功？")) return;
        await api(`/api/admin/avatar-orders/${notice.order_id}`, { action: "resend_notification", notificationId: notice.id }); await refresh();
      })); p.append(button);
    }
    $("adminNotifications").append(p);
  }
  $("adminDiagnostics").textContent = JSON.stringify({ attempts: data.attempts, unmatchedPayments: data.payments, transactions: data.transactions, audit: data.audit }, null, 2);
}
$("adminLogin").addEventListener("submit", event => { event.preventDefault(); secret = $("adminSecret").value.trim(); $("adminSecret").value = ""; run(refresh); });
$("adminLogout").addEventListener("click", () => { secret = ""; data = null; $("adminContent").classList.add("hidden"); $("adminLogin").classList.remove("hidden"); $("adminOrders").replaceChildren(); $("adminDiagnostics").textContent = ""; message("已退出"); });
$("adminRefresh").addEventListener("click", () => run(refresh));
$("reviewId").addEventListener("change", detail);
$("reviewAction").addEventListener("change", () => $("refundProof").classList.toggle("hidden", $("reviewAction").value !== "refunded"));
$("reviewForm").addEventListener("submit", event => { event.preventDefault(); run(async () => {
  const action = $("reviewAction").value;
  if (action === "refunded" && !confirm("仅在资金实际退回且已核对凭证后登记。确认已完成真实退款？")) return;
  $("reviewSubmit").disabled = true;
  try { await api(`/api/admin/refunds/${$("reviewId").value}`, { action, note: $("reviewNote").value, channel: $("reviewChannel").value, proofReference: $("reviewProof").value, amountFen: Math.round(Number($("reviewAmount").value) * 100) }); await refresh(); }
  finally { if (data) detail(); }
}); });
$("reviewImages").addEventListener("click", () => run(async () => {
  const refund = data.refunds.find(row => row.id === $("reviewId").value); if (!refund) return;
  $("adminImages").replaceChildren(); $("adminImages").classList.remove("hidden");
  for (const type of ["source", "result"]) {
    const response = await fetch(`/api/admin/avatar-orders/${refund.order_id}/image?type=${type}`, { headers: { authorization: `Bearer ${secret}` }, cache: "no-store" });
    const figure = document.createElement("figure"), caption = document.createElement("figcaption"); caption.textContent = type === "source" ? "原始照片" : "生成结果";
    if (response.ok) { const img = document.createElement("img"), url = URL.createObjectURL(await response.blob()); img.alt = caption.textContent; img.src = url; img.onload = () => URL.revokeObjectURL(url); figure.append(img); }
    else caption.textContent += "：暂无图片或已过保留期";
    figure.append(caption); $("adminImages").append(figure);
  }
}));
