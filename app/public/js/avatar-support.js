const states = { pending: "待审核", needs_info: "待补充信息", approved: "已批准，等待退款", processing: "退款处理中", refunded: "已退款", rejected: "已驳回", withdrawn: "已撤回" };
export const refundLocked = order => Boolean(order?.primaryRefunded || ["pending", "needs_info", "approved", "processing", "refunded"].includes(order?.refundStatus));
// 只有批准退款后才收回已生成的头像；审核期间用户仍可查看和保存。
export const imageWithheld = order => Boolean(order?.primaryRefunded || ["approved", "processing", "refunded"].includes(order?.refundStatus));
export function initAvatarSupport(api, getOrder, onChange, onError) {
  const $ = id => document.getElementById(id);
  let request, activeId, submitting = false;
  $("openRefundBtn").addEventListener("click", () => {
    const open = $("refundForm").classList.toggle("hidden") === false;
    $("openRefundBtn").setAttribute("aria-expanded", String(open));
    if (open) $("refundReason").focus();
  });
  $("refundForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting) return;
    submitting = true; $("submitRefundBtn").disabled = true;
    try {
      request = await api("/api/refund-requests", { payId: getOrder().payId, reason: $("refundReason").value, details: $("refundDetails").value, contact: $("refundContact").value });
      $("refundForm").classList.add("hidden");
      $("openRefundBtn").setAttribute("aria-expanded", "false");
      await onChange();
    } catch (error) { onError(error.message); }
    finally { submitting = false; $("submitRefundBtn").disabled = false; }
  });
  $("withdrawRefundBtn").addEventListener("click", async () => {
    if (submitting || !confirm("确认撤回这次退款申请？撤回后生成会继续。")) return;
    submitting = true; $("withdrawRefundBtn").disabled = true;
    try {
      request = await api("/api/refund-requests", { payId: getOrder().payId, action: "withdraw" });
      await onChange();
    } catch (error) { onError(error.message); }
    finally { submitting = false; $("withdrawRefundBtn").disabled = false; }
  });
  return async function renderSupport() {
    const order = getOrder();
    $("refundSection").classList.toggle("hidden", !order);
    if (!order) return;
    if (activeId !== order.payId) {
      request = null; activeId = order.payId;
      $("refundForm").reset(); $("refundForm").classList.add("hidden");
    }
    $("refundHint").textContent = order.refundEligible
      ? "本单生成失败或已超过 10 分钟未交付，可申请全额退款。"
      : "生成失败可立即申请退款。超过 10 分钟未交付，可申请全额退款。付款未识别、重复付款或图片问题也可提交核对。";
    try { request = (await api(`/api/refund-requests?payId=${encodeURIComponent(order.payId)}`)).request; }
    catch { $("refundStatus").textContent = "售后进度暂未读取，可稍后刷新查询。"; return; }
    $("openRefundBtn").classList.toggle("hidden", Boolean(request && !["needs_info", "rejected", "refunded", "withdrawn"].includes(request.status)));
    $("openRefundBtn").textContent = order.primaryRefunded ? "核对其他重复付款" : request?.status === "refunded" ? "申请其他款项退款或核对" : request?.status === "needs_info" ? "补充申请信息" : request?.status === "rejected" ? "申请复核" : request?.status === "withdrawn" ? "重新申请退款" : "申请退款或核对付款";
    $("withdrawRefundBtn").classList.toggle("hidden", !(request && ["pending", "needs_info"].includes(request.status) && !order.primaryRefunded));
    $("refundStatus").textContent = request ? `退款申请：${states[request.status] || request.status}。${request.note}${request.status === "refunded" ? ` 退款渠道：${request.channel}；凭证：${request.proofReference}` : ""}` : "";
    if (order.primaryRefunded) {
      $("refundReason").value = "duplicate_payment"; $("refundReason").disabled = true;
    } else if (order.status === "unpaid" && !["pending", "needs_info"].includes(request?.status)) {
      // 未确认付款时只有“付款未识别”能提交，默认选中减少误操作。
      $("refundReason").value = "payment_unconfirmed";
    } else if (request?.status === "needs_info") {
      $("refundReason").value = request.reason;
      $("refundReason").disabled = true;
    } else $("refundReason").disabled = false;
  };
}
