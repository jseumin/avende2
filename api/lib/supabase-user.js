const { isPublicKey } = require("../auth-config");

function getPublicSupabaseConfig() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  let url;
  try {
    url = new URL(SUPABASE_URL);
  } catch {
    throw new Error("Supabase 서버 환경 변수를 확인해 주세요.");
  }
  if (url.protocol !== "https:" || !SUPABASE_ANON_KEY || !isPublicKey(SUPABASE_ANON_KEY)) {
    throw new Error("Supabase 서버 환경 변수를 확인해 주세요.");
  }
  return { url: url.origin, anonKey: SUPABASE_ANON_KEY };
}

async function authenticateSupabaseRequest(req) {
  const authorization = req.headers.authorization || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) {
    const error = new Error("로그인 후 다시 시도해 주세요.");
    error.statusCode = 401;
    throw error;
  }
  const config = getPublicSupabaseConfig();
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.anonKey, Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  const user = await response.json();
  if (!response.ok || !user.id) {
    const error = new Error("로그인 세션이 만료됐어요. 다시 로그인해 주세요.");
    error.statusCode = 401;
    throw error;
  }
  return { ...config, accessToken, user };
}

async function supabaseUserRequest(context, path, options = {}) {
  const response = await fetch(`${context.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: context.anonKey,
      Authorization: `Bearer ${context.accessToken}`,
      "Content-Type": "application/json",
      ...options.headers
    },
    cache: "no-store"
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message || body.msg || "Supabase 요청에 실패했습니다.");
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

async function getRecruitmentPaymentRoster(context, postId) {
  return supabaseUserRequest(context, "rpc/get_recruitment_payment_roster", {
    method: "POST",
    body: JSON.stringify({ p_post_id: postId })
  });
}

async function beginRecruitmentPayments(context, postId) {
  return supabaseUserRequest(context, "rpc/begin_recruitment_payments", {
    method: "POST",
    body: JSON.stringify({ p_post_id: postId })
  });
}

module.exports = {
  authenticateSupabaseRequest,
  beginRecruitmentPayments,
  getRecruitmentPaymentRoster,
  supabaseUserRequest
};
