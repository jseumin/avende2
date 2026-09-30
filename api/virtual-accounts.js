const crypto = require("node:crypto");

const participants = {
  "민지": 15000,
  "서연": 9000,
  "유진": 8000
};
const keyPrefix = "moa:demo-group-auto-refund-01";
const recordTtlSeconds = 60 * 60 * 24 * 30;
const isParticipant = (id) => Object.hasOwn(participants, id);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function validateEnvironment() {
  const { TOSS_CLIENT_KEY, TOSS_SECRET_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, PUBLIC_APP_URL, QSTASH_TOKEN, CRON_SECRET } = process.env;
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
  if (!QSTASH_TOKEN || !CRON_SECRET) {
    throw new Error("Vercel에 Upstash QStash token과 CRON_SECRET 환경 변수를 설정해 주세요.");
  }
  return { TOSS_CLIENT_KEY, TOSS_SECRET_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, PUBLIC_APP_URL, QSTASH_TOKEN, CRON_SECRET };
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

async function readRecord(key) {
  const value = await redisCommand(["GET", key]);
  return value ? JSON.parse(value) : null;
}

async function writeRecord(key, record) {
  await redisCommand(["SET", key, JSON.stringify(record), "EX", String(recordTtlSeconds)]);
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
  const account = record.virtualAccount || {};
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
  return groupId === "demo-group-auto-refund-01";
}

async function ensureGroupDeadline(groupId) {
  const { PUBLIC_APP_URL, QSTASH_TOKEN, CRON_SECRET } = validateEnvironment();
  const groupKey = `${keyPrefix}:group`;
  const current = await readRecord(groupKey);
  if (current) {
    if (current.status !== "COLLECTING" || Date.now() >= current.deadlineAt) {
      const error = new Error("공동배달의 입금 기한이 끝나 취소 처리를 진행하고 있어요.");
      error.statusCode = 409;
      throw error;
    }
    return current;
  }

  const deadlineAt = Date.now() + 60 * 60_000;
  const group = { groupId, status: "COLLECTING", deadlineAt, createdAt: new Date().toISOString() };
  const created = await redisCommand(["SET", groupKey, JSON.stringify(group), "NX", "EX", String(recordTtlSeconds)]);
  if (created !== "OK") {
    const raced = await readRecord(groupKey);
    if (raced?.status === "COLLECTING" && Date.now() < raced.deadlineAt) return raced;
    const error = new Error("공동배달 입금 상태를 준비하지 못했습니다. 다시 시도해 주세요.");
    error.statusCode = 409;
    throw error;
  }

  try {
    const response = await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(`${PUBLIC_APP_URL}/api/expire-group`)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${QSTASH_TOKEN}`,
        "Content-Type": "application/json",
        "Upstash-Not-Before": String(Math.ceil(deadlineAt / 1000) + 5),
        "Upstash-Forward-Authorization": `Bearer ${CRON_SECRET}`
      },
      body: JSON.stringify({ groupId })
    });
    if (!response.ok) throw new Error("입금 마감 예약을 등록하지 못했습니다.");
  } catch (error) {
    await redisCommand(["DEL", groupKey]);
    throw error;
  }
  return group;
}

async function handleGet(req, res) {
  const { groupId, participantId } = req.query;
  if (!validGroupId(groupId)) return json(res, 400, { error: "유효하지 않은 공동배달 ID입니다." });
  if (participantId && !isParticipant(participantId)) return json(res, 400, { error: "유효하지 않은 참여자입니다." });

  const [group, accounts] = await Promise.all([
    readRecord(`${keyPrefix}:group`),
    Promise.all(Object.keys(participants).map(async (id) => {
      const record = await readRecord(`${keyPrefix}:${id}`);
      return record
        ? publicAccount(record)
        : { participantId: id, participantName: id, amount: participants[id], status: "NOT_ISSUED" };
    }))
  ]);
  return json(res, 200, {
    accounts,
    group: group ? { status: group.status, deadlineAt: group.deadlineAt, refundRequested: group.refundRequested || 0, refundActionRequired: group.refundActionRequired || 0 } : null
  });
}

async function handlePost(req, res) {
  const { groupId, participantId, action, orderId } = req.body || {};
  if (!validGroupId(groupId) || !isParticipant(participantId)) {
    return json(res, 400, { error: "공동배달 또는 참여자 정보를 확인해 주세요." });
  }

  const recordKey = `${keyPrefix}:${participantId}`;
  if (action === "abandon") {
    if (typeof orderId !== "string") return json(res, 400, { error: "중단할 주문번호가 없습니다." });
    const pending = await readRecord(`${keyPrefix}:order:${orderId}`);
    if (!pending || pending.participantId !== participantId || pending.status !== "REQUESTING") {
      return json(res, 409, { error: "중단할 결제 요청을 찾을 수 없습니다." });
    }
    pending.status = "FAILED";
    await writeRecord(recordKey, pending);
    await writeRecord(`${keyPrefix}:order:${orderId}`, pending);
    return json(res, 200, { abandoned: true });
  }

  const existing = await readRecord(recordKey);
  if (existing?.status === "WAITING_FOR_DEPOSIT" || existing?.status === "PAID") {
    return json(res, 409, { error: "이미 발급된 가상계좌가 있어요. 기존 계좌를 확인해 주세요." });
  }
  if (existing?.status === "REQUESTING" && Date.now() - Date.parse(existing.createdAt) < 10 * 60_000) {
    return json(res, 409, { error: "가상계좌 발급이 진행 중이에요. 잠시 후 다시 시도해 주세요." });
  }

  const lockKey = `${recordKey}:lock`;
  const lockToken = crypto.randomUUID();
  const locked = await redisCommand(["SET", lockKey, lockToken, "NX", "EX", "30"]);
  if (locked !== "OK") return json(res, 409, { error: "가상계좌 발급을 처리 중이에요. 잠시 후 다시 시도해 주세요." });

  try {
    const group = await ensureGroupDeadline(groupId);
    const current = await readRecord(recordKey);
    if (current?.status === "WAITING_FOR_DEPOSIT" || current?.status === "PAID") {
      return json(res, 409, { error: "이미 발급된 가상계좌가 있어요. 기존 계좌를 확인해 주세요." });
    }
    if (current?.status === "REQUESTING") {
      current.status = "EXPIRED";
      await writeRecord(`${keyPrefix}:order:${current.orderId}`, current);
    }
    const { TOSS_CLIENT_KEY, PUBLIC_APP_URL } = validateEnvironment();
    const orderId = `MOA-${crypto.randomUUID()}`;
    const amount = participants[participantId];
    const pending = {
      groupId,
      participantId,
      participantName: participantId,
      amount,
      orderId,
      status: "REQUESTING",
      createdAt: new Date().toISOString(),
      deadlineAt: group.deadlineAt
    };
    await writeRecord(recordKey, pending);
    await writeRecord(`${keyPrefix}:order:${orderId}`, pending);
    return json(res, 201, {
      clientKey: TOSS_CLIENT_KEY,
      orderId,
      amount,
      orderName: `모아먹자 공동배달 분담금 - ${participantId}`,
      customerName: participantId,
      dueDate: new Date(group.deadlineAt + 9 * 60 * 60_000).toISOString().replace(/\.\d{3}Z$/, ""),
      successUrl: `${PUBLIC_APP_URL}/payment-success.html`,
      failUrl: `${PUBLIC_APP_URL}/payment-fail.html?orderId=${encodeURIComponent(orderId)}&participantId=${encodeURIComponent(participantId)}`
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
module.exports.participants = participants;
module.exports.validateEnvironment = validateEnvironment;
