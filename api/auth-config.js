function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function isPublicKey(key) {
  if (key.startsWith("sb_publishable_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload.role === "anon";
  } catch {
    return false;
  }
}

module.exports = function authConfig(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "GET 요청만 지원합니다." });
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  let url;
  try {
    url = new URL(SUPABASE_URL);
  } catch {
    return json(res, 503, { error: "Supabase URL과 anon key를 Vercel 환경 변수에 설정해 주세요." });
  }

  if (url.protocol !== "https:" || !SUPABASE_ANON_KEY || !isPublicKey(SUPABASE_ANON_KEY)) {
    return json(res, 503, { error: "Supabase HTTPS URL과 publishable/anon 공개 키를 Vercel 환경 변수에 설정해 주세요. secret/service_role 키는 사용할 수 없습니다." });
  }

  return json(res, 200, { url: url.origin, anonKey: SUPABASE_ANON_KEY });
};

module.exports.isPublicKey = isPublicKey;
