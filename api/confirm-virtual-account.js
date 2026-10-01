const { writeAccountAndOrder, tossRequest, publicAccount, getOrderRecord, readGroup } = require("./virtual-accounts");
const { cancelGroup, markGroupReadyIfPaid } = require("./lib/cancel-group");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function confirmVirtualAccount(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "POST 요청만 지원합니다." });
  }
  try {
    const { paymentKey, orderId, amount } = req.body || {};
    if (typeof paymentKey !== "string" || typeof orderId !== "string" || !Number.isSafeInteger(Number(amount))) {
      return json(res, 400, { error: "결제 승인 정보가 올바르지 않습니다." });
    }
    const record = await getOrderRecord(orderId);
    if (!record || record.status === "CANCELED" || record.status === "EXPIRED") {
      return json(res, 404, { error: "승인할 공동배달 주문을 찾을 수 없습니다." });
    }
    if (Number(amount) !== record.amount) {
      return json(res, 400, { error: "요청 금액이 참여자 분담액과 일치하지 않습니다." });
    }
    if (record.status === "PAID" || record.status === "WAITING_FOR_DEPOSIT") {
      return json(res, 200, { account: publicAccount(record, true) });
    }
    if (record.status !== "REQUESTING") {
      return json(res, 409, { error: "현재 결제 요청은 더 이상 승인할 수 없습니다." });
    }
    const group = await readGroup(record.groupId);
    if (!group || group.status !== "COLLECTING" || Date.now() >= group.deadlineAt) {
      return json(res, 409, { error: "입금 마감 시간이 지나 가상계좌를 발급할 수 없습니다." });
    }

    const payment = await tossRequest("/v1/payments/confirm", {
      method: "POST",
      body: JSON.stringify({ paymentKey, orderId, amount: record.amount })
    });
    if (payment.orderId !== orderId || payment.totalAmount !== record.amount || payment.method !== "가상계좌" || !payment.virtualAccount || !payment.secret || !["WAITING_FOR_DEPOSIT", "DONE"].includes(payment.status)) {
      return json(res, 409, { error: "토스 결제 정보가 주문 내용과 일치하지 않습니다." });
    }

    const confirmed = {
      ...record,
      paymentKey: payment.paymentKey,
      secret: payment.secret,
      status: payment.status === "DONE" ? "PAID" : "WAITING_FOR_DEPOSIT",
      virtualAccount: payment.virtualAccount,
      refundReceiveAccount: payment.virtualAccount.refundReceiveAccount || null,
      wasPaid: payment.status === "DONE",
      confirmedAt: new Date().toISOString()
    };
    await writeAccountAndOrder(confirmed);
    const latestGroup = await readGroup(record.groupId);
    const groupReady = confirmed.status === "PAID" && await markGroupReadyIfPaid(record.groupId);
    if (!groupReady && (latestGroup?.status !== "COLLECTING" || Date.now() >= latestGroup.deadlineAt)) {
      await cancelGroup(record.groupId);
      return json(res, 409, { error: "입금 마감과 동시에 계좌가 발급되어 자동 취소·환불 처리를 시작했습니다." });
    }
    return json(res, 200, { account: publicAccount(confirmed, true) });
  } catch (error) {
    console.error("Toss payment confirmation error:", error.message);
    return json(res, error.statusCode || 502, { error: error.message });
  }
};
