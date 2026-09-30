const crypto = require("node:crypto");
const { validateEnvironment } = require("./virtual-accounts");
const { cancelGroup } = require("./lib/cancel-group");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function expireGroup(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "POST 요청만 지원합니다." });
  }

  try {
    const { CRON_SECRET } = validateEnvironment();
    const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
    const provided = Buffer.from(req.headers.authorization || "");
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      return json(res, 401, { error: "예약 작업 인증에 실패했습니다." });
    }

    const { groupId } = req.body || {};
    if (groupId !== "demo-group-auto-refund-01") {
      return json(res, 400, { error: "유효하지 않은 공동배달 ID입니다." });
    }
    const result = await cancelGroup(groupId);
    if (result.status === "NOT_DUE") return json(res, 409, { error: "아직 입금 마감 시간이 되지 않았습니다." });
    return json(res, 200, result);
  } catch (error) {
    console.error("Automatic group cancellation error:", error.message);
    return json(res, 500, { error: "공동배달 취소와 환불 처리가 완료되지 않았습니다. 예약 작업이 다시 시도합니다." });
  }
};
