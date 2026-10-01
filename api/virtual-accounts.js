const crypto = require("node:crypto");
const {
  authenticateSupabaseRequest,
  beginRecruitmentPayments,
  getRecruitmentPaymentRoster
} = require("./lib/supabase-user");

const legacyParticipants = { 민지: 15000, 서연: 9000, 유진: 8000 };
const keyPrefix = "moa:demo-group-auto-refund-01";
const recordTtlSeconds = 60 * 60 * 24 * 30;
const legacyGroupId = "demo-group-auto-refund-01";
const isLegacyGroup = (groupId) => groupId === legacyGroupId;
const isUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function groupKey(groupId) {
  return isLegacyGroup(groupId) ? `${keyPrefix}:group` : `${keyPrefix}:group:${groupId}`;
}

function accountKey(groupId, participantId) {
  return isLegacyGroup(groupId)
    ? `${keyPrefix}:${participantId}`
    : `${keyPrefix}:group:${groupId}:participant:${participantId}`;
}

function scopedOrderKey(groupId, orderId) {
  return isLegacyGroup(groupId)
    ? `${keyPrefix}:order:${orderId}`
    : `${keyPrefix}:group:${groupId}:order:${orderId}`;
}

function orderIndexKey(orderId) {
  return `${keyPrefix}:order-index:${orderId}`;
}

async function readRecord(key) {
  const value = await redisCommand(["GET", key]);
  return value ? JSON.parse(value) : null;
}

async function writeRecord(key, record) {
  await redisCommand(["SET", key, JSON.stringify(record), "EX", String(recordTtlSeconds)]);
}

async function writeAccountAndOrder(record) {
  await Promise.all([
    writeRecord(accountKey(record.groupId, record.participantId), record),
    writeRecord(scopedOrderKey(record.groupId, record.orderId), record),
    writeRecord(orderIndexKey(record.orderId), record)
  ]);
}

async function getOrderRecord(orderId) {
  const indexed = await readRecord(orderIndexKey(orderId));
  return indexed || readRecord(`${keyPrefix}:order:${orderId}`);
}

async function readGroup(groupId) {
  return readRecord(groupKey(groupId));
}

function groupParticipants(group) {
  if (Array.isArray(group?.participants)) return group.participants;
  return Object.entries(legacyParticipants).map(([id, amount]) => ({ id, name: id, amount }));
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function validateEnvironment() {
  const { TOSS_CLIENT_KEY, TOSS_SECRET_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, PUBLIC_APP_URL, QSTASH_URL, QSTASH_TOKEN, CRON_SECRET } = process.env;
  if (!TOSS_CLIENT_KEY || !TOSS_CLIENT_KEY.startsWith("test_ck_")) {
    throw new Error("Vercel에 test_ck_로 시작하는 Toss 테스트 클라이언트 키를 설정해 주세요.");
  }
  if (!TOSS_SECRET_KEY || !TOSS_SECRET_KEY.startsWith("test_sk_")) {
    throw new Error("Vercel에 test_sk_로 시작하는 Toss 테스트 시크릿 키를 설정해 주세요.");
  }
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
    throw new Error("Vercel에 Upstash Redis URL과 token 환경 변수를 설정해 주세요.");
  }
  if (!PUBLIC_APP_URL || !/^https:\/\/[a-z0-9.-]+$/i.test(PUBLIC_APP_URL)) {
    throw new Error("Vercel에 https:// 주소 형식의 PUBLIC_APP_URL을 설정해 주세요.");
  }
  if (!QSTASH_URL || !/^https:\/\/[a-z0-9.-]+$/i.test(QSTASH_URL)) {
    throw new Error("Vercel에 https:// 주소 형식의 QSTASH_URL을 설정해 주세요.");
  }
  if (!QSTASH_TOKEN || !CRON_SECRET) {
    throw new Error("Vercel에 Upstash QStash token과 CRON_SECRET 환경 변수를 설정해 주세요.");
  }
  return { TOSS_CLIENT_KEY, TOSS_SECRET_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, PUBLIC_APP_URL, QSTASH_URL, QSTASH_TOKEN, CRON_SECRET };
}

async function redisCommand(command) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = validateEnvironment();
  const response = await fetch(UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error("입금 상태 저장소 요청에 실패했습니다.");
  return result.result;
}

async function tossRequest(path, options = {}) {
  const { TOSS_SECRET_KEY } = validateEnvironment();
  const response = await fetch(`https://api.tosspayments.com${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64")}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message || "토스페이먼츠 요청에 실패했습니다.");
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

function publicAccount(record, includeAccountNumber = false) {
  const account = record?.virtualAccount || {};
  return {
    participantId: record.participantId,
    participantName: record.participantName,
    amount: record.amount,
    status: record.status,
    orderId: record.orderId,
    createdAt: record.createdAt,
    bankCode: account.bank || null,
    accountNumber: includeAccountNumber ? account.accountNumber || null : null,
    dueDate: account.dueDate || null
  };
}

function validGroupId(groupId) {
  return isLegacyGroup(groupId) || isUuid(groupId);
}

async function authenticateGroupRequest(req, groupId) {
  const context = await authenticateSupabaseRequest(req);
  if (isLegacyGroup(groupId)) return { context, roster: Object.entries(legacyParticipants).map(([id, amount]) => ({ participant_id: id, participant_name: id, amount })) };
  if (!isUuid(groupId)) {
    const error = new Error("유효하지 않은 모집글 ID입니다.");
    error.statusCode = 400;
    throw error;
  }
  const roster = await getRecruitmentPaymentRoster(context, groupId);
  if (!Array.isArray(roster) || !roster.some((person) => person.participant_id === context.user.id)) {
    const error = new Error("해당 모집글의 승인된 참여자만 입금 정보를 볼 수 있습니다.");
    error.statusCode = 403;
    throw error;
  }
  roster.sort((left, right) => left.participant_id.localeCompare(right.participant_id));
  return { context, roster };
}

async function ensureGroupDeadline(groupId, context, roster) {
  const { PUBLIC_APP_URL, QSTASH_URL, QSTASH_TOKEN, CRON_SECRET } = validateEnvironment();
  const redisGroupKey = groupKey(groupId);
  const current = await readRecord(redisGroupKey);
  if (current) {
    const sameRoster = JSON.stringify(current.participants) === JSON.stringify(roster);
    if (!sameRoster) {
      const error = new Error("참여자 또는 메뉴 금액이 바뀌어 결제를 시작할 수 없습니다.");
      error.statusCode = 409;
      throw error;
    }
    if (current.status !== "COLLECTING" || Date.now() >= current.deadlineAt) {
      const error = new Error("공동배달의 입금 기한이 끝나 취소 처리를 진행하고 있어요.");
      error.statusCode = 409;
      throw error;
    }
    return current;
  }

  if (!isLegacyGroup(groupId)) {
    await beginRecruitmentPayments(context, groupId);
  }
  const deadlineAt = Date.now() + 60 * 60_000;
  const group = {
    groupId,
    status: isLegacyGroup(groupId) ? "COLLECTING" : "PREPARING",
    participants: roster,
    deadlineAt,
    createdAt: new Date().toISOString()
  };
  const created = await redisCommand(["SET", redisGroupKey, JSON.stringify(group), "NX", "EX", String(recordTtlSeconds)]);
  if (created !== "OK") {
    const raced = await readRecord(redisGroupKey);
    if (raced?.status === "COLLECTING" && Date.now() < raced.deadlineAt) return raced;
    const error = new Error("공동배달 입금 상태를 준비하지 못했습니다. 다시 시도해 주세요.");
    error.statusCode = 409;
    throw error;
  }

  try {
    const response = await fetch(`${QSTASH_URL}/v2/publish/${PUBLIC_APP_URL}/api/expire-group`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${QSTASH_TOKEN}`,
        "Content-Type": "application/json",
        "Upstash-Not-Before": String(Math.ceil(deadlineAt / 1000) + 5),
        "Upstash-Forward-Authorization": `Bearer ${CRON_SECRET}`
      },
      body: JSON.stringify({ groupId })
    });
    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 500);
      throw new Error(`QStash 예약 실패 (HTTP ${response.status}): ${responseBody || "응답 내용 없음"}`);
    }
    if (!isLegacyGroup(groupId)) {
      group.status = "COLLECTING";
      await writeRecord(redisGroupKey, group);
    }
  } catch (error) {
    await redisCommand(["DEL", redisGroupKey]);
    throw error;
  }
  return group;
}

async function handleGet(req, res) {
  const { groupId, participantId } = req.query;
  if (!validGroupId(groupId)) return json(res, 400, { error: "유효하지 않은 모집글 ID입니다." });
  const { context, roster } = await authenticateGroupRequest(req, groupId);
  if (participantId && participantId !== context.user.id) {
    return json(res, 403, { error: "본인의 계좌 번호만 조회할 수 있습니다." });
  }

  const accounts = await Promise.all(roster.map(async (person) => {
    const participantIdValue = person.participant_id || person.id;
    let record = await readRecord(accountKey(groupId, participantIdValue));
    if (record?.status === "WAITING_FOR_DEPOSIT") {
      record = await reconcileDepositStatus(record);
    }
    if (record) return publicAccount(record, participantId === participantIdValue);
    return {
      participantId: participantIdValue,
      participantName: person.participant_name || person.name,
      amount: person.amount,
      status: "NOT_ISSUED"
    };
  }));
  const group = await readRecord(groupKey(groupId));
  return json(res, 200, {
    accounts,
    group: group ? { status: group.status, deadlineAt: group.deadlineAt, refundRequested: group.refundRequested || 0, refundActionRequired: group.refundActionRequired || 0 } : null
  });
}

async function reconcileDepositStatus(record) {
  const redisAccountKey = accountKey(record.groupId, record.participantId);
  const checkKey = `${redisAccountKey}:toss-status-check`;
  const checkToken = crypto.randomUUID();
  const acquired = await redisCommand(["SET", checkKey, checkToken, "NX", "EX", "15"]);
  if (acquired !== "OK") return (await readRecord(redisAccountKey)) || record;

  const latest = await readRecord(redisAccountKey);
  if (!latest || latest.status !== "WAITING_FOR_DEPOSIT") return latest || record;

  const paymentPath = latest.paymentKey
    ? `/v1/payments/${encodeURIComponent(latest.paymentKey)}`
    : `/v1/payments/orders/${encodeURIComponent(latest.orderId)}`;
  const payment = await tossRequest(paymentPath);
  if (payment.orderId !== latest.orderId || payment.totalAmount !== latest.amount || payment.method !== "가상계좌") {
    throw new Error("토스 결제 정보가 주문 내용과 일치하지 않습니다.");
  }
  if (payment.status === "DONE") {
    const paidRecord = {
      ...latest,
      status: "PAID",
      wasPaid: true,
      paidAt: payment.approvedAt || new Date().toISOString(),
      virtualAccount: payment.virtualAccount || latest.virtualAccount,
      refundReceiveAccount: payment.virtualAccount?.refundReceiveAccount || latest.refundReceiveAccount || null
    };
    await writeAccountAndOrder(paidRecord);
    const { markGroupReadyIfPaid } = require("./lib/cancel-group");
    await markGroupReadyIfPaid(record.groupId);
    return paidRecord;
  }
  if (payment.status === "CANCELED" || payment.status === "EXPIRED") {
    const updatedRecord = { ...latest, status: payment.status };
    await writeAccountAndOrder(updatedRecord);
    return updatedRecord;
  }
  return latest;
}

async function handlePost(req, res) {
  const { groupId, participantId, action, orderId } = req.body || {};
  if (!validGroupId(groupId)) return json(res, 400, { error: "유효하지 않은 모집글 ID입니다." });
  const { context, roster } = await authenticateGroupRequest(req, groupId);
  if (participantId !== context.user.id) {
    return json(res, 403, { error: "본인 가상계좌만 발급하거나 관리할 수 있습니다." });
  }
  const participant = roster.find((person) => (person.participant_id || person.id) === participantId);
  if (!participant) return json(res, 403, { error: "승인된 모집글 참여자만 결제할 수 있습니다." });
  const amount = participant.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return json(res, 409, { error: "결제 전에 본인 메뉴를 선택해 주세요." });
  }

  const redisAccountKey = accountKey(groupId, participantId);
  if (action === "abandon") {
    if (typeof orderId !== "string") return json(res, 400, { error: "중단할 주문번호가 없습니다." });
    const pending = await readRecord(scopedOrderKey(groupId, orderId));
    if (!pending || pending.participantId !== participantId || pending.status !== "REQUESTING") {
      return json(res, 409, { error: "중단할 결제 요청을 찾을 수 없습니다." });
    }
    pending.status = "FAILED";
    await writeAccountAndOrder(pending);
    return json(res, 200, { abandoned: true });
  }

  const existing = await readRecord(redisAccountKey);
  if (existing?.status === "WAITING_FOR_DEPOSIT" || existing?.status === "PAID") {
    return json(res, 409, { error: "이미 발급된 가상계좌가 있어요. 기존 계좌를 확인해 주세요." });
  }
  if (existing?.status === "REQUESTING" && Date.now() - Date.parse(existing.createdAt) < 10 * 60_000) {
    return json(res, 409, { error: "가상계좌 발급이 진행 중이에요. 잠시 후 다시 시도해 주세요." });
  }

  const lockKey = `${redisAccountKey}:lock`;
  const lockToken = crypto.randomUUID();
  const locked = await redisCommand(["SET", lockKey, lockToken, "NX", "EX", "30"]);
  if (locked !== "OK") return json(res, 409, { error: "가상계좌 발급을 처리 중이에요. 잠시 후 다시 시도해 주세요." });

  try {
    const group = await ensureGroupDeadline(groupId, context, roster.map((person) => ({
      id: person.participant_id || person.id,
      name: person.participant_name || person.name,
      amount: person.amount
    })));
    const current = await readRecord(redisAccountKey);
    if (current?.status === "WAITING_FOR_DEPOSIT" || current?.status === "PAID") {
      return json(res, 409, { error: "이미 발급된 가상계좌가 있어요. 기존 계좌를 확인해 주세요." });
    }
    if (current?.status === "REQUESTING") {
      current.status = "EXPIRED";
      await writeAccountAndOrder(current);
    }
    const { TOSS_CLIENT_KEY, PUBLIC_APP_URL } = validateEnvironment();
    const newOrderId = `MOA-${crypto.randomUUID()}`;
    const participantName = participant.participant_name || participant.name;
    const pending = {
      groupId,
      participantId,
      participantName,
      amount,
      orderId: newOrderId,
      status: "REQUESTING",
      createdAt: new Date().toISOString(),
      deadlineAt: group.deadlineAt
    };
    await writeAccountAndOrder(pending);
    return json(res, 201, {
      clientKey: TOSS_CLIENT_KEY,
      orderId: newOrderId,
      amount,
      orderName: `모아먹자 공동배달 분담금 - ${participantName}`,
      customerName: participantName,
      dueDate: new Date(group.deadlineAt + 9 * 60 * 60_000).toISOString().replace(/\.\d{3}Z$/, ""),
      successUrl: `${PUBLIC_APP_URL}/payment-success.html`,
      failUrl: `${PUBLIC_APP_URL}/payment-fail.html?groupId=${encodeURIComponent(groupId)}&orderId=${encodeURIComponent(newOrderId)}&participantId=${encodeURIComponent(participantId)}`
    });
  } finally {
    const currentToken = await redisCommand(["GET", lockKey]);
    if (currentToken === lockToken) await redisCommand(["DEL", lockKey]);
  }
}

module.exports = async function virtualAccounts(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "지원하지 않는 요청 방식입니다." });
  }
  try {
    validateEnvironment();
    if (req.method === "GET") return await handleGet(req, res);
    return await handlePost(req, res);
  } catch (error) {
    const statusCode = error.statusCode || (error.message.startsWith("Vercel에") ? 503 : 502);
    if (statusCode >= 500) console.error("Virtual account API error:", error.message);
    return json(res, statusCode, { error: error.message });
  }
};

module.exports.redisCommand = redisCommand;
module.exports.readRecord = readRecord;
module.exports.writeRecord = writeRecord;
module.exports.tossRequest = tossRequest;
module.exports.publicAccount = publicAccount;
module.exports.keyPrefix = keyPrefix;
module.exports.participants = legacyParticipants;
module.exports.groupKey = groupKey;
module.exports.accountKey = accountKey;
module.exports.scopedOrderKey = scopedOrderKey;
module.exports.orderIndexKey = orderIndexKey;
module.exports.writeAccountAndOrder = writeAccountAndOrder;
module.exports.getOrderRecord = getOrderRecord;
module.exports.readGroup = readGroup;
module.exports.groupParticipants = groupParticipants;
module.exports.validGroupId = validGroupId;
module.exports.validateEnvironment = validateEnvironment;
