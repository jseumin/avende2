const crypto = require("node:crypto");
const {
  readRecord,
  writeRecord,
  tossRequest,
  groupKey,
  accountKey,
  writeAccountAndOrder,
  readGroup,
  groupParticipants
} = require("../virtual-accounts");

function hasRefundAccount(account) {
  return typeof account?.bankCode === "string"
    && typeof account?.accountNumber === "string"
    && typeof account?.holderName === "string"
    && account.bankCode.length > 0
    && account.accountNumber.length > 0
    && account.holderName.length > 0;
}

async function cancelPayment(record) {
  const payment = await tossRequest(`/v1/payments/${encodeURIComponent(record.paymentKey)}`);
  if (payment.orderId !== record.orderId || payment.totalAmount !== record.amount) {
    throw new Error("취소할 결제의 주문번호 또는 금액이 일치하지 않습니다.");
  }
  if (payment.status === "CANCELED" || payment.status === "EXPIRED" || payment.status === "ABORTED") {
    const wasPaid = record.wasPaid || record.status === "PAID" || payment.virtualAccount?.refundStatus === "COMPLETED" || payment.virtualAccount?.refundStatus === "PENDING";
    return {
      ...record,
      status: wasPaid ? "REFUND_REQUESTED" : "CANCELED",
      wasPaid,
      refundStatus: payment.virtualAccount?.refundStatus || record.refundStatus || null
    };
  }

  const wasPaid = payment.status === "DONE" || record.status === "PAID" || record.wasPaid;
  const refundReceiveAccount = record.refundReceiveAccount || payment.virtualAccount?.refundReceiveAccount;
  if (wasPaid && !hasRefundAccount(refundReceiveAccount)) {
    return { ...record, status: "REFUND_ACTION_REQUIRED", wasPaid: true };
  }

  const idempotencyKey = record.cancelIdempotencyKey || crypto.randomUUID();
  const updated = { ...record, status: "CANCEL_REQUESTING", wasPaid, cancelIdempotencyKey: idempotencyKey };
  await writeAccountAndOrder(updated);

  const canceled = await tossRequest(`/v1/payments/${encodeURIComponent(record.paymentKey)}/cancel`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      cancelReason: "공동배달 입금 마감 시간 내 미입금으로 주문 취소",
      ...(wasPaid ? { refundReceiveAccount } : {})
    })
  });
  if (canceled.orderId !== record.orderId || canceled.status !== "CANCELED") {
    throw new Error("토스에서 가상계좌 취소를 확인하지 못했습니다.");
  }
  return {
    ...updated,
    status: wasPaid ? "REFUND_REQUESTED" : "CANCELED",
    refundStatus: canceled.virtualAccount?.refundStatus || (wasPaid ? "PENDING" : null),
    canceledAt: new Date().toISOString()
  };
}

async function cancelGroup(groupId) {
  const redisGroupKey = groupKey(groupId);
  const group = await readGroup(groupId);
  if (!group || group.groupId !== groupId) return { status: "NOT_FOUND" };
  if (group.status === "ORDER_READY") return { status: group.status };
  if (group.status === "COLLECTING" && await markGroupReadyIfPaid(groupId)) {
    return { status: "ORDER_READY" };
  }
  if (group.status === "COLLECTING" && Date.now() < group.deadlineAt) {
    return { status: "NOT_DUE" };
  }

  group.status = "CANCELLING";
  group.cancellationStartedAt ||= new Date().toISOString();
  await writeRecord(redisGroupKey, group);

  let retryNeeded = false;
  const participants = groupParticipants(group);
  for (const participant of participants) {
    const participantId = participant.id;
    const record = await readRecord(accountKey(groupId, participantId));
    if (!record || ["CANCELED", "EXPIRED", "FAILED", "REFUND_REQUESTED", "REFUND_ACTION_REQUIRED"].includes(record.status)) continue;

    let updated = record;
    if (record.status === "REQUESTING" && !record.paymentKey) {
      updated = { ...record, status: "CANCELED", canceledAt: new Date().toISOString() };
    } else if (record.paymentKey) {
      try {
        updated = await cancelPayment(record);
      } catch (error) {
        console.error(`Cancellation failed for ${participantId}:`, error.message);
        retryNeeded = true;
        continue;
      }
    } else {
      updated = { ...record, status: "CANCELED", canceledAt: new Date().toISOString() };
    }

    await writeAccountAndOrder(updated);
  }

  const records = await Promise.all(participants.map((participant) => readRecord(accountKey(groupId, participant.id))));
  const hasRefundActionRequired = records.some((record) => record?.status === "REFUND_ACTION_REQUIRED");
  const hasRefunds = records.some((record) => record?.status === "REFUND_REQUESTED");
  const stillProcessing = records.some((record) => record && !["CANCELED", "EXPIRED", "FAILED", "REFUND_REQUESTED", "REFUND_ACTION_REQUIRED"].includes(record.status));

  group.status = retryNeeded || stillProcessing
    ? "CANCELLING"
    : hasRefundActionRequired
      ? "REFUND_ACTION_REQUIRED"
      : hasRefunds
        ? "REFUNDING"
        : "CANCELED";
  group.refundRequested = records.filter((record) => record?.status === "REFUND_REQUESTED").length;
  group.refundActionRequired = records.filter((record) => record?.status === "REFUND_ACTION_REQUIRED").length;
  group.updatedAt = new Date().toISOString();
  await writeRecord(redisGroupKey, group);

  if (retryNeeded || stillProcessing) throw new Error("일부 가상계좌 취소를 완료하지 못해 재시도가 필요합니다.");
  return { status: group.status, refundRequested: group.refundRequested, refundActionRequired: group.refundActionRequired };
}

async function markGroupReadyIfPaid(groupId) {
  const redisGroupKey = groupKey(groupId);
  const group = await readGroup(groupId);
  if (!group || group.groupId !== groupId || group.status !== "COLLECTING") return false;
  const participants = groupParticipants(group);
  const records = await Promise.all(participants.map((participant) => readRecord(accountKey(groupId, participant.id))));
  if (!records.every((record) => record?.status === "PAID")) return false;
  group.status = "ORDER_READY";
  group.allPaidAt = new Date().toISOString();
  await writeRecord(redisGroupKey, group);
  return true;
}

module.exports = { cancelGroup, markGroupReadyIfPaid };
