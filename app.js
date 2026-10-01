const posts = [];
const applications = [];

const categories = ["전체", "치킨", "피자", "한식", "중식", "일식", "양식", "분식"];
const categoryIcons = { 전체: "✦", 치킨: "🍗", 피자: "🍕", 한식: "🍚", 중식: "🥟", 일식: "🍣", 양식: "🍔", 분식: "🍡" };
const restaurantCatalog = [
  {
    id: "yeonnam-chicken",
    name: "연남 치킨집",
    category: "치킨",
    emoji: "🍗",
    theme: "chicken",
    minimumOrder: 18000,
    menu: [
      { id: "original-chicken", name: "후라이드 치킨", price: 18000 },
      { id: "seasoned-chicken", name: "양념 치킨", price: 20000 },
      { id: "cheese-balls", name: "치즈볼", price: 5000 },
      { id: "cola", name: "콜라", price: 2000 }
    ]
  },
  {
    id: "yeonnam-pizza",
    name: "연남 피자",
    category: "피자",
    emoji: "🍕",
    theme: "pizza",
    minimumOrder: 22000,
    menu: [
      { id: "cheese-pizza", name: "치즈 피자", price: 22000 },
      { id: "pepperoni-pizza", name: "페퍼로니 피자", price: 25000 },
      { id: "garlic-bread", name: "갈릭 브레드", price: 5000 },
      { id: "soda", name: "탄산음료", price: 2000 }
    ]
  },
  {
    id: "hongdae-tteokbokki",
    name: "홍대 분식집",
    category: "분식",
    emoji: "🍡",
    theme: "tteok",
    minimumOrder: 15000,
    menu: [
      { id: "tteokbokki", name: "떡볶이", price: 12000 },
      { id: "fried-snacks", name: "모둠 튀김", price: 7000 },
      { id: "rice-roll", name: "참치 김밥", price: 5000 },
      { id: "fish-cake", name: "어묵탕", price: 6000 }
    ]
  }
];
const pageContent = document.querySelector("#pageContent");
const toast = document.querySelector("#toast");
const modalBackdrop = document.querySelector("#modalBackdrop");
const modalContent = document.querySelector("#modalContent");
let currentPage = "discover";
let selectedCategory = "전체";
let sortBy = "distance";
let selectedPost = null;
let paid = new Set();
let received = new Set(["민지", "유진"]);
let rating = 0;
const customMenu = [];
const virtualAccounts = new Map();
let virtualAccountError = "";
let accountRefreshTimer = null;
let paymentGroup = null;
let authInitialization = Promise.resolve();
let passwordRecoveryShown = false;
const authState = { client: null, user: null, error: "" };
const paymentParticipants = [{ name: "민지", amount: 15000 }, { name: "서연", amount: 9000 }, { name: "유진", amount: 8000 }];
const demoGroupId = "demo-group-auto-refund-01";
const bankNames = { "06": "KB국민은행", "11": "NH농협은행", "20": "우리은행", "81": "하나은행", "88": "신한은행" };

function mapRecruitmentPost(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    restaurantId: row.restaurant_id,
    restaurant: row.restaurant,
    emoji: row.emoji,
    theme: row.theme,
    category: row.category,
    distance: row.distance_meters,
    joined: row.joined,
    max: row.max_participants,
    minimum: row.minimum_amount,
    amount: row.current_amount,
    selectedMenu: row.selected_menu || [],
    deadline: row.deadline,
    leader: row.leader,
    rating: String(row.rating),
    trades: row.trades,
    note: row.note
  };
}

async function loadRecruitmentPosts() {
  if (!authState.client) return;
  const { data, error } = await authState.client
    .from("recruitment_posts")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw error;
  posts.splice(0, posts.length, ...data.map(mapRecruitmentPost));
}

async function loadApplications() {
  applications.splice(0, applications.length);
  if (!authState.client || !authState.user) return;
  const { data, error } = await authState.client
    .from("recruitment_applications")
    .select("id, post_id, applicant_id, applicant_name, status, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  applications.push(...data);
}

async function refreshRecruitmentData() {
  await loadRecruitmentPosts();
  await loadApplications();
  render();
}

const won = (value) => `${value.toLocaleString("ko-KR")}원`;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const avatarClass = (name) => ({ 서연: "avatar-me", 민지: "avatar-purple", 준호: "avatar-blue", 하은: "avatar-pink", 도윤: "avatar-purple", 유진: "avatar-pink", 시우: "avatar-blue" }[name] || "avatar-purple");
const avatar = (name, large = false) => `<span class="avatar ${large ? "avatar-large" : avatarClass(name)}">${escapeHTML(name.slice(0, 1))}</span>`;
const currentUserName = () => authState.user ? authDisplayName() : "게스트";
const participantName = (name) => name === "서연" ? currentUserName() : name;
const isPostOwner = (post) => post.ownerId === (authState.user?.id || "guest");

function menuSelectionMarkup(restaurantId) {
  const restaurant = restaurantCatalog.find((entry) => entry.id === restaurantId);
  if (!restaurant) return `<p class="subheading">먼저 음식점을 선택해 주세요.</p>`;
  return restaurant.menu.map((item) => `<label class="menu-choice">
    <span><strong>${escapeHTML(item.name)}</strong><small>${won(item.price)}</small></span>
    <input type="number" name="menu-${escapeHTML(item.id)}" data-menu-id="${escapeHTML(item.id)}" data-menu-name="${escapeHTML(item.name)}" data-menu-price="${item.price}" min="0" max="10" value="0" aria-label="${escapeHTML(item.name)} 수량" />
  </label>`).join("");
}

function updateCreateOrderSummary(form) {
  const summary = form.querySelector("#orderSummary");
  const restaurant = restaurantCatalog.find((entry) => entry.id === form.elements.restaurantId.value);
  if (!restaurant) {
    summary.innerHTML = `<span>음식점을 선택하면 최소주문금액을 확인할 수 있어요.</span>`;
    return;
  }
  const menu = [...form.querySelectorAll("[data-menu-id]")]
    .map((input) => ({
      id: input.dataset.menuId,
      name: input.dataset.menuName,
      price: Number(input.dataset.menuPrice),
      quantity: Number(input.value)
    }))
    .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
  const total = menu.reduce((sum, item) => sum + item.price * item.quantity, 0);
  summary.innerHTML = `<div><span>선택 메뉴 합계</span><strong>${won(total)}</strong></div>
    <div><span>식당 최소주문금액</span><strong>${won(restaurant.minimumOrder)}</strong></div>
    <div><span>최소주문까지</span><strong class="money-need">${won(Math.max(restaurant.minimumOrder - total, 0))} 남음</strong></div>`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}

async function readApiResponse(response, fallbackMessage) {
  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error("Vercel 배포의 API와 Toss·Upstash 환경 변수를 설정한 뒤 이용해 주세요.");
  }
  if (!response.ok) throw new Error(result.error || fallbackMessage);
  return result;
}

function setPage(page) {
  window.clearInterval(accountRefreshTimer);
  accountRefreshTimer = null;
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  render();
  if (page === "payment") {
    refreshVirtualAccounts();
    accountRefreshTimer = window.setInterval(refreshVirtualAccounts, 8000);
  }
  if (page === "applicants" && authState.user) {
    void loadApplications().then(render).catch((error) => {
      console.error("Recruitment applications loading error:", error.message);
      showToast(`신청자 정보를 불러오지 못했습니다: ${error.message}`);
    });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderPostCard(post) {
  return `<article class="post-card" data-post="${escapeHTML(post.id)}" tabindex="0" aria-label="${escapeHTML(post.restaurant)} 모집글 상세 보기">
    <div class="post-top">
      <div class="food-thumb ${escapeHTML(post.theme)}">${escapeHTML(post.emoji)}</div>
      <div class="post-head">
        <div class="post-restaurant"><strong>${escapeHTML(post.restaurant)}</strong><span class="tag">${escapeHTML(post.category)}</span></div>
        <div class="post-sub">최소주문 ${won(post.minimum)}</div>
      </div>
      <span class="post-distance">⌖ ${post.distance}m</span>
    </div>
    <div class="post-meta"><span class="member-count"><b>${post.joined}</b> / ${post.max}명 모집 중</span><span class="post-deadline">◷ ${post.deadline}</span></div>
    <div class="post-money"><span>현재 모인 금액</span><strong>${won(post.amount)}</strong></div>
    <div class="post-money"><span>최소주문까지</span><strong class="money-need">${won(Math.max(post.minimum - post.amount, 0))} 남음</strong></div>
    <div class="leader-line">${avatar(post.leader)}<span>${escapeHTML(post.leader)} 리더</span><span class="leader-rating"><b class="star">★</b> ${escapeHTML(post.rating)} · 거래 ${post.trades}회</span></div>
  </article>`;
}

function discoverPage() {
  const visible = posts
    .filter((post) => post.distance <= 300)
    .filter((post) => selectedCategory === "전체" || post.category === selectedCategory)
    .sort((a, b) => sortBy === "deadline"
      ? Number.parseInt(a.deadline, 10) - Number.parseInt(b.deadline, 10)
      : a.distance - b.distance);
  return `<div class="page-heading"><div><div class="eyebrow">GOOD FOOD, GOOD COMPANY</div><h1>같이 먹으면 더 맛있으니까<span class="brand-period">.</span></h1><p class="subheading">내 주변의 따뜻한 한 끼, 지금 함께 나눠요.</p></div></div>
    <section class="hero"><div class="hero-copy"><div class="hero-kicker">혼자 시키기 부담스러울 때,</div><h2>우리 같이 시켜 먹을까요?</h2><p>가까운 이웃과 배달비도, 최소주문금액도 나눠요.</p><button class="primary-button" data-page="create">모집글 만들기 <span>→</span></button></div><div class="hero-art"><span class="art-leaf one">🌿</span><span class="art-leaf two">✿</span><div class="art-circle"></div><div class="art-plate">🍜</div></div></section>
    <div class="stat-row">
      <div class="stat-card"><span class="stat-icon mint">⌖</span><div class="stat-copy"><small>내 주변 모집글</small><strong>${visible.length} <em>개</em></strong></div></div>
      <div class="stat-card"><span class="stat-icon peach">♧</span><div class="stat-copy"><small>오늘 아낀 배달비</small><strong>₩ 4,500</strong></div></div>
      <div class="stat-card"><span class="stat-icon lilac">♡</span><div class="stat-copy"><small>함께한 이웃</small><strong>8 <em>명</em></strong></div></div>
    </div>
    <section><div class="section-title"><h2>어떤 음식이 당기세요? <span>카테고리</span></h2></div>
      <div class="category-row">${categories.map((category) => `<button class="category-chip ${selectedCategory === category ? "active" : ""}" data-category="${category}"><span>${categoryIcons[category]}</span>${category}</button>`).join("")}</div>
    </section>
    <section><div class="section-title"><h2>내 주변 모집글 <span>${visible.length}개</span></h2><button class="text-button" data-action="refresh">지도에서 보기 ↗</button></div>
      <div class="list-toolbar"><span>내 위치에서 300m 이내 · ${sortBy === "distance" ? "가까운 순" : "마감 임박 순"}</span><select class="sort-select" aria-label="정렬"><option value="distance" ${sortBy === "distance" ? "selected" : ""}>가까운 순</option><option value="deadline" ${sortBy === "deadline" ? "selected" : ""}>마감 임박 순</option></select></div>
      <div class="post-grid">${visible.length ? visible.map(renderPostCard).join("") : `<div class="empty-state">선택한 카테고리의 모집글이 아직 없어요.<br />다른 카테고리를 선택하거나 첫 모집글을 만들어 보세요!</div>`}</div>
    </section>
    <section class="workflow-card"><div class="section-title"><h2>함께하는 과정 <span>처음이어도 어렵지 않아요</span></h2></div><div class="workflow-steps">${["모집글 탐색", "동참 신청", "메뉴 결정", "함께 입금", "음식 수령", "서로 평가"].map((item, i) => `<div class="workflow-step ${i === 0 ? "current" : ""}"><div class="step-dot">${i + 1}</div>${item}</div>`).join("")}</div></section>`;
}

function detailPage() {
  const post = selectedPost;
  const isOwner = isPostOwner(post);
  const myApplication = applications.find((application) => application.post_id === post.id && application.applicant_id === authState.user?.id);
  const applicationStatus = myApplication?.status || null;
  const full = post.joined >= post.max;
  return `<div class="page-heading"><div><div class="eyebrow">GROUP ORDER · ${post.distance}M AWAY</div><h1>모집글 상세</h1><p class="subheading">함께 주문할 이웃과 자세한 내용을 확인해요.</p></div><button class="secondary-button" data-page="discover">← 목록으로</button></div>
    <div class="detail-layout"><section class="page-card">
      <div class="detail-food"><div class="food-thumb ${escapeHTML(post.theme)}">${escapeHTML(post.emoji)}</div><div><span class="tag">${escapeHTML(post.category)}</span><h2>${escapeHTML(post.restaurant)}</h2><p>⌖ 내 위치에서 ${post.distance}m · 배달 예정 약 40분</p></div></div>
      <div class="detail-stats"><div class="detail-stat"><small>모집 인원</small><strong>${post.joined} / ${post.max}명</strong></div><div class="detail-stat"><small>최소주문금액</small><strong>${won(post.minimum)}</strong></div><div class="detail-stat"><small>현재 주문금액</small><strong>${won(post.amount)}</strong></div></div>
      ${post.selectedMenu?.length ? `<div class="detail-block"><h3>선택한 메뉴</h3>${post.selectedMenu.map((item) => `<p>${escapeHTML(item.name)} × ${item.quantity} · ${won(item.price * item.quantity)}</p>`).join("")}</div>` : ""}
      <div class="detail-block"><h3>리더의 한마디</h3><p>${escapeHTML(post.note)}</p></div>
      <div class="detail-block"><h3>모집 안내</h3><p>모집 마감 ${escapeHTML(post.deadline)}<br />메뉴는 매칭 후 공동 채팅방에서 함께 정해요. 만남 장소와 수령 시간도 채팅으로 편하게 조율할 수 있어요.</p></div>
    </section><aside class="page-card"><div class="section-title"><h2>리더 정보</h2><button class="text-button" data-action="leader-profile">프로필 보기</button></div>
      <div class="leader-card">${avatar(post.leader, true)}<div class="leader-info"><strong>${escapeHTML(post.leader)}</strong><small>따뜻한 한 끼를 함께해요</small></div></div>
      <div class="reputation-row"><div><strong><span class="star">★</span> ${post.rating}</strong>평점</div><div><strong>${post.trades}회</strong>거래 횟수</div><div><strong>100%</strong>매너 온도</div></div>
      <div class="detail-block"><h3>최소주문까지</h3><p style="color:#e68b5d;font-weight:700;font-size:15px">${won(Math.max(post.minimum - post.amount, 0))} 남았어요</p></div>
      ${isOwner
        ? `<button class="primary-button" style="width:100%;margin-top:17px" data-page="applicants">신청자 관리</button><div class="join-note">내가 만든 모집글이에요. 신청할 수 없습니다.</div>`
        : `<button class="primary-button" style="width:100%;margin-top:17px" data-action="apply" ${full || applicationStatus === "approved" || applicationStatus === "rejected" ? "disabled" : ""}>${applicationStatus === "pending" ? "신청 취소하기" : applicationStatus === "approved" ? "신청 승인됨" : applicationStatus === "rejected" ? "신청 거절됨" : !authState.user ? "로그인 후 신청" : full ? "모집 인원 마감" : "동참 신청하기"} <span>→</span></button>
      <div class="join-note">${applicationStatus === "pending" ? "리더의 승인을 기다리고 있어요." : applicationStatus === "approved" ? "모집자가 참여 신청을 승인했어요." : applicationStatus === "rejected" ? "이번 모집글 신청이 거절되었어요." : full ? "모집 인원이 모두 찼어요." : !authState.user ? "신청하려면 로그인해 주세요." : "신청 후 리더의 승인을 기다려요."}</div>`}
    </aside></div>`;
}

function createPage() {
  return `<div class="page-heading"><div><div class="eyebrow">START A GROUP ORDER</div><h1>모집글 만들기</h1><p class="subheading">함께 먹을 이웃을 찾아볼까요?</p></div><button class="secondary-button" data-page="discover">← 돌아가기</button></div>
    <section class="page-card"><div class="section-title"><h2>주문 정보를 입력해 주세요</h2><span class="subheading">* 필수 입력 항목</span></div>
      <form id="createForm"><div class="form-grid">
        <div class="form-field full"><label for="restaurantId">음식점 *</label><select id="restaurantId" name="restaurantId" required><option value="">음식점을 선택해 주세요</option>${restaurantCatalog.map((restaurant) => `<option value="${restaurant.id}">${restaurant.emoji} ${restaurant.name} · 최소 ${won(restaurant.minimumOrder)}</option>`).join("")}</select></div>
        <div class="form-field full"><label>메뉴와 수량 *</label><div id="menuSelection" class="menu-selection"><p class="subheading">먼저 음식점을 선택해 주세요.</p></div></div>
        <div class="form-field full"><label>주문 금액</label><div id="orderSummary" class="order-summary"><span>음식점을 선택하면 최소주문금액을 확인할 수 있어요.</span></div></div>
        <div class="form-field"><label for="members">모집 인원 *</label><select id="members" name="members"><option>2명</option><option selected>3명</option><option>4명</option><option>5명</option></select></div>
        <div class="form-field"><label for="deadline">모집 마감 시간 *</label><select id="deadline" name="deadline"><option>15분 후</option><option>30분 후</option><option>1시간 후</option><option>직접 설정</option></select></div>
        <div class="form-field"><label for="deliveryTime">희망 배달 시간</label><input id="deliveryTime" name="deliveryTime" type="time" /></div>
        <div class="form-field full"><label for="note">기타 전달사항</label><textarea id="note" name="note" placeholder="메뉴나 만남 장소에 관한 내용을 적어주세요."></textarea></div>
      </div><div class="form-actions"><button type="button" class="secondary-button" data-page="discover">취소</button><button class="primary-button" type="submit">모집글 올리기 →</button></div></form>
    </section>`;
}

function applicantsPage() {
  const myPosts = posts.filter(isPostOwner);
  return `<div class="page-heading"><div><div class="eyebrow">LEADER DASHBOARD</div><h1>신청자 관리</h1><p class="subheading">내가 올린 모집글의 신청자를 확인해요.</p></div><button class="secondary-button" data-page="discover">모집글 보기</button></div>
    ${myPosts.length
      ? `<section class="owned-post-list">${myPosts.map((post) => {
        const postApplications = applications.filter((application) => application.post_id === post.id);
        return `<article class="page-card owned-post-card"><div class="section-title"><h2>${escapeHTML(post.restaurant)}</h2><span class="tag">${escapeHTML(post.category)}</span></div><p class="subheading">${escapeHTML(post.deadline)} · 참여 ${post.joined} / ${post.max}명</p>
          ${postApplications.length
            ? postApplications.map((application) => `<div class="applicant-row"><span class="avatar">${escapeHTML(application.applicant_name.slice(0, 1))}</span><div class="applicant-copy"><strong>${escapeHTML(application.applicant_name)}</strong><small>${application.status === "pending" ? "참여 신청을 보냈어요." : application.status === "approved" ? "신청을 승인했어요." : "신청을 거절했어요."}</small></div><div class="applicant-actions">${application.status === "pending" ? `<button class="primary-button" data-action="review-application" data-application-id="${application.id}" data-decision="approved">승인</button><button class="secondary-button" data-action="review-application" data-application-id="${application.id}" data-decision="rejected">거절</button>` : `<span class="status-pill ${application.status === "approved" ? "status-paid" : "status-pending"}">${application.status === "approved" ? "승인됨" : "거절됨"}</span>`}</div></div>`).join("")
            : `<p class="subheading">아직 신청한 사람이 없어요.</p>`}
          <button class="secondary-button" data-action="manage-owned-post" data-post-id="${post.id}">모집글 확인</button></article>`;
      }).join("")}</section>`
      : `<section class="page-card"><div class="empty-state">아직 등록한 모집글이 없어요.<br />모집글을 만들면 이곳에서 신청자를 확인할 수 있어요.<br /><button class="primary-button" style="margin-top:16px" data-page="create">모집글 만들기</button></div></section>`}`;
}

async function refreshVirtualAccounts() {
  if (currentPage !== "payment") return;
  try {
    const response = await fetch(`/api/virtual-accounts?groupId=${encodeURIComponent(demoGroupId)}`, { cache: "no-store" });
    const result = await readApiResponse(response, "입금 상태를 불러오지 못했어요.");
    virtualAccounts.clear();
    for (const account of result.accounts) virtualAccounts.set(account.participantId, account);
    paymentGroup = result.group;
    paid = new Set(result.accounts.filter((account) => account.status === "PAID").map((account) => account.participantId));
    virtualAccountError = "";
    if (currentPage === "payment") render();
  } catch (error) {
    virtualAccountError = error.message.includes("Failed to fetch")
      ? "Vercel 배포에서 API를 사용하고 Toss·Upstash 환경 변수를 설정해 주세요."
      : error.message;
    if (currentPage === "payment") render();
  }
}

async function showParticipantAccount(participantId) {
  let checkoutOrderId = "";
  const existing = virtualAccounts.get(participantId);
  if (existing?.status === "REQUESTING" && Date.now() - Date.parse(existing.createdAt) < 10 * 60_000) {
    showToast("진행 중인 토스 결제창에서 가상계좌 발급을 완료해 주세요.");
    return;
  }
  const button = document.querySelector(`[data-action="participant-account"][data-participant="${participantId}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "처리 중...";
  }
  try {
    let response;
    if (existing && existing.status !== "NOT_ISSUED") {
      response = await fetch(`/api/virtual-accounts?groupId=${encodeURIComponent(demoGroupId)}&participantId=${encodeURIComponent(participantId)}`, { cache: "no-store" });
      const result = await readApiResponse(response, "가상계좌 정보를 불러오지 못했어요.");
      const account = result.accounts?.find((entry) => entry.participantId === participantId);
      if (!account) throw new Error("참여자 계좌를 찾을 수 없어요.");
      virtualAccounts.set(participantId, account);
      if (account.status === "PAID") paid.add(participantId);
      render();
      const bankName = bankNames[account.bankCode] || "가상계좌 은행";
      const accountNumber = account.accountNumber
        ? `<div class="issued-account-number">${escapeHTML(account.accountNumber)}</div><button class="secondary-button" data-action="copy-issued-account" data-account="${escapeHTML(account.accountNumber)}">계좌번호 복사</button>`
        : "<p>입금 확인을 기다리고 있어요.</p>";
      const accountOwner = participantName(participantId);
      openModal(`<div class="eyebrow">TOSS TEST VIRTUAL ACCOUNT</div><h2 id="modalTitle">${escapeHTML(accountOwner)}님의 가상계좌</h2><p>아래 계좌는 이 참여자의 분담액 전용입니다. 정확한 금액으로 입금해 주세요.</p><div class="issued-account-card"><strong>${escapeHTML(bankName)}</strong>${accountNumber}<span>입금 금액 <b>${won(account.amount)}</b></span><span>입금 상태 <b>${account.status === "PAID" ? "입금 완료" : "입금 대기"}</b></span><span>입금 기한 <b>${escapeHTML(account.dueDate || "토스페이먼츠 안내 시간")}</b></span></div><button class="primary-button" id="modalDone">확인</button>`);
      return;
    } else {
      response = await fetch("/api/virtual-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: demoGroupId,
          participantId
        })
      });
    }
    const result = await readApiResponse(response, "가상계좌를 처리하지 못했어요.");
    checkoutOrderId = result.orderId;
    virtualAccounts.set(participantId, {
      participantId,
      participantName: participantId,
      amount: result.amount,
      orderId: result.orderId,
      status: "REQUESTING",
      createdAt: new Date().toISOString()
    });
    render();
    if (typeof window.TossPayments !== "function") throw new Error("토스 결제창 SDK를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.");
    const tossPayments = window.TossPayments(result.clientKey);
    await tossPayments.requestPayment("가상계좌", {
      amount: result.amount,
      orderId: result.orderId,
      orderName: result.orderName,
      customerName: result.customerName,
      dueDate: result.dueDate,
      successUrl: result.successUrl,
      failUrl: result.failUrl
    });
    showToast("토스 결제창에서 가상계좌 발급을 완료해 주세요.");
  } catch (error) {
    virtualAccountError = error.message;
    if (checkoutOrderId) {
      fetch("/api/virtual-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abandon", groupId: demoGroupId, participantId, orderId: checkoutOrderId })
      });
      virtualAccounts.set(participantId, { participantId, participantName: participantId, status: "FAILED" });
    }
    render();
    showToast(error.message);
  }
}

function chatPage() {
  const name = currentUserName();
  const menu = [{ name: "숯불양념치킨", by: "민지", price: 18000, quantity: 1 }, { name: "치즈볼", by: "유진", price: 5000, quantity: 1 }, { name: "콜라", by: name, price: 2000, quantity: 1 }, ...customMenu];
  return `<div class="page-heading"><div><div class="eyebrow">GROUP ROOM · 3명 참여 중</div><h1>꼬꼬아찌 같이 시켜요 🍗</h1><p class="subheading">연남동 · 오늘 오후 7:30 배달 예정</p></div><button class="secondary-button" data-page="payment">입금 현황 →</button></div>
    <div class="chat-layout"><section class="chat-panel"><div class="chat-header"><div><strong>🍗 꼬꼬아찌 숯불치킨</strong><small>민지, 유진, ${escapeHTML(name)} · 3명</small></div><div class="online-dots">${["민지", "유진", name].map((person) => avatar(person)).join("")}</div></div><div class="chat-status">● 메뉴 결정 중 <span style="color:#a1aaa4">　→　입금 대기　→　결제 완료　→　배달 중</span></div>
      <div class="chat-messages" id="chatMessages"><div class="chat-message">${avatar("민지")}<div><div class="bubble">안녕하세요! 숯불양념치킨으로 주문하려고 해요 🍗</div><span class="message-time">오후 7:12</span></div></div><div class="chat-message">${avatar("유진")}<div><div class="bubble">좋아요! 치즈볼도 하나 추가할게요 🙌</div><span class="message-time">오후 7:14</span></div></div><div class="chat-message mine">${avatar(name)}<div><div class="bubble">저는 콜라 추가할게요. 메뉴 확정해도 좋을 것 같아요!</div><span class="message-time">오후 7:15</span></div></div></div>
      <form id="chatForm" class="chat-input"><input name="message" required placeholder="메시지를 입력해 주세요..." /><button aria-label="메시지 보내기">↑</button></form>
    </section><aside><section class="page-card">    <div class="section-title"><h2>현재 주문 내역</h2><button class="text-button" data-action="add-menu">＋ 메뉴 추가</button></div><div class="menu-order">${menu.map((item) => `<div class="order-line"><span>${escapeHTML(item.by)} · ${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ""}</span><strong>${won(item.price * item.quantity)}</strong></div>`).join("")}<div class="order-total"><span>총 주문금액</span><strong>${won(menu.reduce((total, item) => total + item.price * item.quantity, 0))}</strong></div></div><button class="primary-button" style="width:100%;margin-top:15px" data-action="confirm-order">주문 내용 확정하기</button></section>
      <section class="page-card" style="margin-top:13px"><div class="section-title"><h2>참여자</h2></div>${["민지", "유진", "서연"].map((person) => { const isMe = person === "서연"; const label = participantName(person); return `<div class="participant-row">${avatar(label)}<div class="participant-copy"><strong>${escapeHTML(label)}${isMe ? " (나)" : ""}</strong><small>${person === "민지" ? "리더" : "참여자"}</small></div><span class="status-pill ${isMe ? "status-paid" : "status-pending"}">${isMe ? "메뉴 선택" : "참여 중"}</span></div>`; }).join("")}</section></aside></div>`;
}

function paymentPage() {
  const people = paymentParticipants;
  const total = people.reduce((sum, person) => sum + person.amount, 0);
  const paidTotal = people.filter((person) => paid.has(person.name)).reduce((sum, person) => sum + person.amount, 0);
  const allPaid = people.every((person) => paid.has(person.name));
  return `<div class="page-heading"><div><div class="eyebrow">PARTICIPANT VIRTUAL ACCOUNTS</div><h1>함께 입금하기</h1><p class="subheading">참여자마다 분담액이 지정된 가상계좌를 따로 발급해요.</p></div><button class="secondary-button" data-page="chat">← 채팅방</button></div>
    <div class="detail-layout"><section class="page-card"><div class="payment-total"><small>총 결제 예정 금액</small><strong>${won(total)}</strong></div><div class="section-title" style="margin-top:22px"><h2>입금 현황</h2><span class="subheading">${people.filter((person) => paid.has(person.name)).length} / ${people.length}명 완료</span></div>
      ${people.map((person) => {
        const account = virtualAccounts.get(person.name);
        const status = account?.status || "NOT_ISSUED";
        const displayName = participantName(person.name);
        const paidStatus = status === "PAID";
        const statusLabel = paidStatus ? "입금 완료"
          : status === "REFUND_REQUESTED" ? "환불 처리 중"
            : status === "REFUND_ACTION_REQUIRED" ? "환불 확인 필요"
              : status === "CANCEL_REQUESTING" ? "취소 처리 중"
                : status === "EXPIRED" || status === "CANCELED" || status === "FAILED" ? "발급 종료"
                  : status === "WAITING_FOR_DEPOSIT" ? "입금 대기"
                    : status === "REQUESTING" ? "발급 처리 중" : "계좌 미발급";
        const canIssue = status === "NOT_ISSUED" || status === "FAILED" || status === "EXPIRED" || status === "CANCELED";
        const groupOpen = !paymentGroup || paymentGroup.status === "COLLECTING";
        const actionLabel = canIssue ? "계좌 발급" : status === "REQUESTING" ? "발급 진행 중" : "계좌 확인";
        const showAction = canIssue && groupOpen;
        return `<div class="participant-row payment-participant">${avatar(displayName)}<div class="participant-copy"><strong>${escapeHTML(displayName)}${person.name === "서연" ? " (나)" : ""}</strong><small>${person.name === "민지" ? "리더" : "참여자"} · ${won(person.amount)}</small></div><span class="status-pill ${paidStatus ? "status-paid" : status === "REFUND_ACTION_REQUIRED" ? "status-pending" : "status-pending"}">${statusLabel}</span>${showAction ? `<button class="secondary-button account-action" data-action="participant-account" data-participant="${person.name}" ${status === "REQUESTING" ? "disabled" : ""}>${actionLabel}</button>` : ""}</div>`;
      }).join("")}
      <div class="progress-track"><div class="progress-fill" style="width:${Math.round((paidTotal / total) * 100)}%"></div></div><div class="progress-caption"><span>입금 완료 금액 ${won(paidTotal)}</span><span>${Math.round((paidTotal / total) * 100)}%</span></div>
    </section><aside class="page-card"><div class="section-title"><h2>참여자별 가상계좌</h2><span class="tag">Toss 테스트</span></div><p class="subheading">결제창에서 은행을 선택하면 각 계좌에 해당 참여자의 분담액만 입금할 수 있어요.</p>
      <div class="account-info-box">${virtualAccountError ? `<strong>연동 설정이 필요해요</strong><span>${escapeHTML(virtualAccountError)}</span>` : paymentGroup?.status === "COLLECTING" ? `<strong>입금 마감 ${new Date(paymentGroup.deadlineAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</strong><span>마감까지 전원이 입금하지 않으면 공동배달은 자동 취소됩니다. 입금 완료자의 환불 계좌가 확인되면 환불을 요청해요.</span>` : paymentGroup?.status === "ORDER_READY" ? "<strong>모든 참여자의 입금이 완료됐어요</strong><span>공동배달 주문을 진행할 수 있습니다.</span>" : paymentGroup?.status === "CANCELLING" ? "<strong>공동배달 취소 처리 중</strong><span>미입금 계좌를 취소하고 입금된 금액의 환불을 요청하고 있어요.</span>" : paymentGroup?.status === "REFUND_ACTION_REQUIRED" ? "<strong>환불 계좌 확인이 필요해요</strong><span>입금자의 환불 계좌 정보가 없어 자동 환불을 진행하지 못했습니다. 토스 결제내역에서 해당 결제를 확인해 주세요.</span>" : paymentGroup?.status === "REFUNDING" ? "<strong>공동배달이 취소됐어요</strong><span>입금 완료 금액의 환불을 요청했습니다. 은행 처리에는 영업일 기준 시간이 걸릴 수 있어요.</span>" : paymentGroup?.status === "CANCELED" ? "<strong>공동배달이 취소됐어요</strong><span>입금 마감까지 전원이 입금하지 않아 미입금 계좌를 취소했어요.</span>" : "<strong>입금 상태 자동 확인</strong><span>첫 참여자가 계좌 발급을 시작하면 1시간 입금 마감이 시작돼요.</span>"}</div>
      <div class="account-info-box refund-notice"><strong>환불 계좌 안내</strong><span>자동 환불을 위해 Toss 결제창에서 환불 계좌 입력이 필요해요. 토스 상점 설정에서 가상계좌 환불 정보 입력을 켜야 합니다. 계좌 정보가 없으면 자동 환불 대신 확인이 필요해요.</span></div>
      <div class="detail-block"><h3>분담액 예시</h3><p>리더 15,000원 · ${escapeHTML(currentUserName())} 9,000원 · 유진 8,000원<br />각 참여자는 자신의 가상계좌에 표시된 금액을 입금해요.</p></div>
      <div class="join-note">${allPaid ? "모든 금액이 입금되었습니다. 배달 주문을 진행합니다." : "모든 참여자의 입금이 확인되면 주문을 진행해요."}</div>
    </aside></div>`;
}

function deliveryPage() {
  const name = currentUserName();
  const steps = ["모집 완료", "메뉴 결정", "입금 대기", "결제 완료", "배달 중", "수령 확인"];
  return `<div class="page-heading"><div><div class="eyebrow">ORDER TRACKING</div><h1>공동배달 진행 상황</h1><p class="subheading">함께하는 주문의 모든 순간을 확인해요.</p></div><button class="secondary-button" data-page="chat">채팅방에서 조율하기</button></div>
    <section class="page-card"><div class="section-title"><h2>꼬꼬아찌 숯불치킨</h2><span class="status-pill status-paid">배달 중</span></div><p class="subheading">주문번호 #MM-0928-03 · 오늘 오후 7:18 주문 완료</p>
      <div class="timeline">${steps.map((step, i) => `<div class="timeline-step ${i < 4 ? "done" : i === 4 ? "current" : ""}"><div class="step-dot">${i < 4 ? "✓" : i + 1}</div>${step}</div>`).join("")}</div>
      <div class="delivery-summary"><div class="summary-tile"><small>예상 도착 시간</small><strong>오후 7:48 ~ 8:00</strong></div><div class="summary-tile"><small>주문 금액</small><strong>32,000원 · 결제 완료</strong></div><div class="summary-tile"><small>만남 장소</small><strong>연남동 주민센터 앞</strong></div><div class="summary-tile"><small>음식 수령 확인</small><strong>${received.size} / 3명</strong></div></div>
    </section>    <div class="detail-layout" style="margin-top:15px"><section class="page-card"><div class="section-title"><h2>음식 수령 확인</h2><span class="subheading">${received.size} / 3명</span></div><p class="subheading">음식을 전달받은 뒤 수령 완료를 눌러주세요. 모두 확인하면 거래가 완료돼요.</p>${["민지", "서연", "유진"].map((person) => { const isMe = person === "서연"; const label = participantName(person); return `<div class="participant-row">${avatar(label)}<div class="participant-copy"><strong>${escapeHTML(label)}${isMe ? " (나)" : ""}</strong><small>${person === "민지" ? "리더" : "참여자"}</small></div><span class="status-pill ${received.has(person) ? "status-paid" : "status-pending"}">${received.has(person) ? "수령 확인" : "대기 중"}</span></div>`; }).join("")}
      <button class="primary-button" style="width:100%;margin-top:13px" data-action="received">${received.has("서연") ? "수령 완료 ✓" : "수령 완료하기"}</button></section>
      <aside class="page-card"><div class="section-title"><h2>주문 정보</h2></div><div class="detail-block"><h3>주문 상태</h3><p>음식이 조리 완료되어 배달 중이에요. 채팅방에서 만남 장소와 수령 시간을 조율할 수 있어요.</p></div><button class="secondary-button" style="width:100%;margin-top:17px" data-page="chat">공동 채팅방 열기</button></aside>
    </div>${received.size === 3 ? `<section class="page-card" style="margin-top:15px;text-align:center"><h2 style="font-size:16px">모든 참여자가 음식 수령을 확인했어요!</h2><p class="subheading">함께한 이웃과 즐거운 식사였나요?</p><button class="primary-button" data-action="review">서로 평가하기 →</button></section>` : ""}`;
}

function profilePage() {
  const profileName = currentUserName();
  return `<div class="page-heading"><div><div class="eyebrow">YOUR NEIGHBOR PROFILE</div><h1>내 프로필</h1><p class="subheading">함께한 이웃이 남긴 따뜻한 기록이에요.</p></div><button class="secondary-button" data-action="edit-profile">프로필 수정</button></div>
    <section class="page-card account-card"><div class="section-title"><h2>로그인 계정</h2></div><div id="profileAuthDetails">${authAccountMarkup()}</div></section>
    <section class="page-card"><div class="profile-hero">${avatar(profileName, true)}<div><h2>${escapeHTML(profileName)} <span class="tag">매너 온도 38.5°</span></h2><p>연남동 이웃 · 모아먹자와 함께한 지 3개월</p></div></div><div class="profile-numbers"><div><strong><span class="star">★</span> 4.8</strong>평균 별점</div><div><strong>23회</strong>공동배달</div><div><strong>18개</strong>받은 후기</div></div></section>
    <section class="page-card" style="margin-top:15px"><div class="section-title"><h2>이웃들의 후기 <span>최근순</span></h2></div>
      <div class="review-item"><strong style="font-size:11px">민지 <span class="star">★★★★★</span></strong><p>약속 시간 잘 지켜주시고, 메뉴도 미리 정리해 주셔서 편했어요. 다음에도 같이 먹어요!</p><small>치킨 같이 먹어요 · 2026.09.20</small></div>
      <div class="review-item"><strong style="font-size:11px">준호 <span class="star">★★★★★</span></strong><p>응답도 빠르고 매너가 정말 좋으셨어요 😊</p><small>피자 나눠 먹기 · 2026.09.14</small></div>
      <div class="review-item"><strong style="font-size:11px">하은 <span class="star">★★★★☆</span></strong><p>수령 장소를 잘 조율해 주셔서 감사했어요!</p><small>초밥 같이 주문해요 · 2026.09.08</small></div>
    </section>`;
}

function render() {
  const pages = { discover: discoverPage, detail: detailPage, create: createPage, applicants: applicantsPage, chat: chatPage, payment: paymentPage, delivery: deliveryPage, profile: profilePage };
  pageContent.innerHTML = (pages[currentPage] || discoverPage)();
}

function openModal(content) {
  modalContent.innerHTML = content;
  modalBackdrop.hidden = false;
}

function authDisplayName() {
  const metadataName = authState.user?.user_metadata?.display_name;
  return typeof metadataName === "string" && metadataName.trim()
    ? metadataName.trim()
    : authState.user?.email?.split("@")[0] || "이웃";
}

function authAccountMarkup() {
  if (!authState.user) {
    return `<p class="subheading">이메일로 로그인하면 계정을 연결할 수 있어요.</p><button class="primary-button" data-action="auth-open">이메일로 로그인</button>`;
  }
  return `<div class="auth-account-row"><div><strong>${escapeHTML(authDisplayName())}</strong><small>${escapeHTML(authState.user.email || "")}</small></div><button class="secondary-button" data-action="auth-logout">로그아웃</button></div>`;
}

function updateAuthUI() {
  const name = authState.user ? authDisplayName() : "게스트";
  const authButton = document.querySelector("#authButton");
  if (authButton) {
    authButton.textContent = authState.user ? "로그아웃" : "로그인";
    authButton.dataset.action = authState.user ? "auth-logout" : "auth-open";
  }
  ["#sidebarUserName", "#topProfileName"].forEach((selector) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = name;
  });
  ["#sidebarAvatar", "#topProfileAvatar"].forEach((selector) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = name.slice(0, 1);
  });
  const detail = document.querySelector("#sidebarUserDetail");
  if (detail) detail.textContent = authState.user?.email || "로그인하면 계정을 연결해요";
  render();
}

function showAuthModal(mode = "login") {
  const setupError = authState.error
    ? `<p class="auth-error" role="status">${escapeHTML(authState.error)}</p><p class="auth-hint">관리자는 Vercel에 SUPABASE_URL과 SUPABASE_ANON_KEY를 등록한 뒤 재배포해 주세요.</p>`
    : "";
  const signup = mode === "signup";
  const reset = mode === "reset";
  openModal(`<div class="eyebrow">MOAEAT ACCOUNT</div>
    <h2 id="modalTitle">${signup ? "이메일로 회원가입" : reset ? "비밀번호 재설정" : "로그인"}</h2>
    <p>${signup ? "이메일 인증을 마치면 계정이 만들어져요." : reset ? "가입한 이메일로 비밀번호 재설정 링크를 보내드려요." : "모아먹자 계정으로 로그인해 주세요."}</p>
    ${setupError}
    <form id="authForm" data-mode="${mode}">
      ${signup ? `<div class="form-field"><label for="authName">닉네임</label><input id="authName" name="name" type="text" maxlength="40" autocomplete="nickname" required /></div>` : ""}
      <div class="form-field"><label for="authEmail">이메일</label><input id="authEmail" name="email" type="email" autocomplete="email" required /></div>
      ${reset ? "" : `<div class="form-field"><label for="authPassword">비밀번호</label><input id="authPassword" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="${signup ? "8" : "1"}" required /></div>`}
      <div class="auth-message" id="authMessage" role="status" aria-live="polite"></div>
      <button class="primary-button" id="authSubmit" type="submit">${signup ? "인증 메일 보내기" : reset ? "재설정 메일 보내기" : "로그인"}</button>
    </form>
    <div class="auth-links">${reset
      ? `<button type="button" class="text-button" data-action="auth-mode-login">로그인으로 돌아가기</button>`
      : signup
        ? `<span>이미 계정이 있나요?</span><button type="button" class="text-button" data-action="auth-mode-login">로그인</button>`
        : `<button type="button" class="text-button" data-action="auth-mode-reset">비밀번호를 잊으셨나요?</button><span>계정이 없나요?</span><button type="button" class="text-button" data-action="auth-mode-signup">회원가입</button>`}
    </div>`);
}

function showPasswordUpdateModal() {
  if (passwordRecoveryShown) return;
  passwordRecoveryShown = true;
  openModal(`<div class="eyebrow">PASSWORD RECOVERY</div><h2 id="modalTitle">새 비밀번호 설정</h2>
    <p>계정에 사용할 새 비밀번호를 입력해 주세요.</p>
    <form id="authForm" data-mode="update-password">
      <div class="form-field"><label for="authPassword">새 비밀번호</label><input id="authPassword" name="password" type="password" autocomplete="new-password" minlength="8" required /></div>
      <div class="form-field"><label for="authPasswordConfirm">새 비밀번호 확인</label><input id="authPasswordConfirm" name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required /></div>
      <div class="auth-message" id="authMessage" role="status" aria-live="polite"></div>
      <button class="primary-button" id="authSubmit" type="submit">비밀번호 변경</button>
    </form>`);
}

async function initializeAuth() {
  try {
    const response = await fetch("/api/auth-config", { cache: "no-store" });
    const config = await readApiResponse(response, "Supabase 인증 설정을 불러오지 못했습니다.");
    if (!window.supabase?.createClient) throw new Error("인증 라이브러리를 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
    authState.client = window.supabase.createClient(config.url, config.anonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    const { data, error } = await authState.client.auth.getSession();
    if (error) throw error;
    authState.user = data.session?.user || null;
    const isPasswordRecovery = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
    authState.client.auth.onAuthStateChange((event, session) => {
      authState.user = session?.user || null;
      updateAuthUI();
      if (event === "PASSWORD_RECOVERY") showPasswordUpdateModal();
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void refreshRecruitmentData().catch((error) => {
          console.error("Recruitment data refresh error:", error.message);
          showToast(`모집글 정보를 불러오지 못했습니다: ${error.message}`);
        });
      }
    });
    updateAuthUI();
    if (isPasswordRecovery) showPasswordUpdateModal();
  } catch (error) {
    authState.error = error.message;
    console.error("Supabase authentication initialization error:", error.message);
    updateAuthUI();
    return;
  }

  try {
    await refreshRecruitmentData();
  } catch (error) {
    console.error("Recruitment posts loading error:", error.message);
    showToast(`모집글을 불러오지 못했습니다: ${error.message}`);
  }
}

async function submitAuthForm(event) {
  event.preventDefault();
  await authInitialization;
  const form = event.target;
  const message = form.querySelector("#authMessage");
  const submit = form.querySelector("#authSubmit");
  const mode = form.dataset.mode;
  const values = new FormData(form);
  const email = String(values.get("email") || "").trim();
  const password = String(values.get("password") || "");
  const setMessage = (text, isError = false) => {
    message.textContent = text;
    message.classList.toggle("auth-error", isError);
  };
  if (!authState.client) {
    setMessage(authState.error || "인증 설정을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.", true);
    return;
  }

  submit.disabled = true;
  try {
    if (mode === "signup") {
      const name = String(values.get("name") || "").trim();
      const { data, error } = await authState.client.auth.signUp({
        email,
        password,
        options: { data: { display_name: name }, emailRedirectTo: window.location.origin }
      });
      if (error) throw error;
      if (data.session) {
        authState.user = data.session.user;
        closeModal();
        updateAuthUI();
        showToast("회원가입과 로그인이 완료됐어요.");
      } else {
        setMessage("인증 메일을 보냈어요. 메일함에서 링크를 눌러 가입을 완료해 주세요.");
        submit.disabled = false;
      }
    } else if (mode === "login") {
      const { data, error } = await authState.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      authState.user = data.user;
      closeModal();
      updateAuthUI();
      showToast("로그인했어요.");
    } else if (mode === "reset") {
      const { error } = await authState.client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) throw error;
      setMessage("비밀번호 재설정 링크를 이메일로 보냈어요.");
      submit.disabled = false;
    } else if (mode === "update-password") {
      const passwordConfirm = String(values.get("passwordConfirm") || "");
      if (password !== passwordConfirm) {
        setMessage("두 비밀번호가 일치하지 않습니다.", true);
        submit.disabled = false;
        return;
      }
      const { data, error } = await authState.client.auth.updateUser({ password });
      if (error) throw error;
      authState.user = data.user;
      closeModal();
      updateAuthUI();
      showToast("비밀번호를 변경했어요.");
    }
  } catch (error) {
    setMessage(error.message || "인증 요청을 완료하지 못했습니다. 다시 시도해 주세요.", true);
    submit.disabled = false;
  }
}

async function signOut() {
  await authInitialization;
  if (!authState.client) {
    showToast(authState.error || "인증 설정을 불러오지 못했습니다.");
    return;
  }
  try {
    const { error } = await authState.client.auth.signOut();
    if (error) {
      showToast(`로그아웃하지 못했습니다: ${error.message}`);
      return;
    }
    authState.user = null;
    updateAuthUI();
    showToast("로그아웃했어요.");
  } catch (error) {
    showToast(`로그아웃하지 못했습니다: ${error.message}`);
  }
}

async function applyToPost() {
  await authInitialization;
  if (!authState.client || !authState.user) {
    showToast("신청하려면 먼저 로그인해 주세요.");
    showAuthModal("login");
    return;
  }
  if (isPostOwner(selectedPost)) {
    showToast("내가 만든 모집글에는 동참 신청할 수 없어요.");
    return;
  }

  const existing = applications.find((application) => application.post_id === selectedPost.id && application.applicant_id === authState.user.id);
  if (existing?.status === "pending") {
    const { error } = await authState.client
      .from("recruitment_applications")
      .delete()
      .eq("id", existing.id);
    if (error) {
      showToast(`신청을 취소하지 못했습니다: ${error.message}`);
      return;
    }
    showToast("신청을 취소했어요.");
  } else if (existing?.status === "approved") {
    showToast("이미 신청이 승인되었어요.");
    return;
  } else if (existing?.status === "rejected") {
    showToast("이번 모집글 신청은 거절되었어요.");
    return;
  } else {
    const { error } = await authState.client
      .from("recruitment_applications")
      .insert({
        post_id: selectedPost.id,
        applicant_id: authState.user.id,
        applicant_name: currentUserName()
      });
    if (error) {
      showToast(`신청을 보내지 못했습니다: ${error.message}`);
      return;
    }
    showToast("참여 신청을 보냈어요. 모집자가 확인하면 결과가 반영됩니다.");
  }

  try {
    await loadApplications();
    render();
  } catch (error) {
    showToast(`신청 상태를 새로고침하지 못했습니다: ${error.message}`);
  }
}

async function reviewApplication(applicationId, decision) {
  if (!authState.client || !authState.user || !["approved", "rejected"].includes(decision)) {
    showToast("신청을 처리할 수 없습니다. 로그인 상태를 확인해 주세요.");
    return;
  }
  const { error } = await authState.client.rpc("review_recruitment_application", {
    application_id: applicationId,
    decision
  });
  if (error) {
    showToast(`신청을 처리하지 못했습니다: ${error.message}`);
    return;
  }

  try {
    await refreshRecruitmentData();
    showToast(decision === "approved" ? "참여 신청을 승인했어요." : "참여 신청을 거절했어요.");
  } catch (error) {
    showToast(`처리 결과를 새로고침하지 못했습니다: ${error.message}`);
  }
}

function closeModal() {
  modalBackdrop.hidden = true;
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button, [data-post]");
  if (!target) return;
  if (target.matches("[data-page]")) {
    setPage(target.dataset.page);
    return;
  }
  if (target.dataset.category) {
    selectedCategory = target.dataset.category;
    render();
    return;
  }
  if (target.dataset.post) {
    selectedPost = posts.find((post) => String(post.id) === target.dataset.post);
    if (!selectedPost) return;
    setPage("detail");
    return;
  }
  switch (target.dataset.action) {
    case "auth-open": showAuthModal("login"); break;
    case "auth-mode-login": showAuthModal("login"); break;
    case "auth-mode-signup": showAuthModal("signup"); break;
    case "auth-mode-reset": showAuthModal("reset"); break;
    case "auth-logout": signOut(); break;
    case "manage-owned-post": {
      selectedPost = posts.find((post) => String(post.id) === target.dataset.postId) || null;
      if (selectedPost) setPage("detail");
      break;
    }
    case "review-application":
      void reviewApplication(target.dataset.applicationId, target.dataset.decision).catch((error) => {
        console.error("Application review error:", error.message);
        showToast(`신청을 처리하지 못했습니다: ${error.message}`);
      });
      break;
    case "refresh": showToast("현재 위치 주변의 모집글을 보여드리고 있어요."); break;
    case "apply":
      if (isPostOwner(selectedPost)) {
        showToast("내가 만든 모집글에는 동참 신청할 수 없어요.");
        break;
      }
      if (selectedPost.joined >= selectedPost.max) {
        showToast("모집 인원이 모두 찼어요.");
        break;
      }
      void applyToPost().catch((error) => {
        console.error("Application submission error:", error.message);
        showToast(`신청을 처리하지 못했습니다: ${error.message}`);
      });
      break;
    case "leader-profile":
      openModal(`<div class="eyebrow">NEIGHBOR PROFILE</div><h2>${escapeHTML(selectedPost.leader)}님의 프로필</h2><p>함께한 이웃의 평판과 거래 경험을 확인해 보세요.</p><div class="reputation-row"><div><strong><span class="star">★</span> ${selectedPost.rating}</strong>평점</div><div><strong>${selectedPost.trades}회</strong>거래</div><div><strong>100%</strong>매너</div></div><p>“약속 시간을 잘 지키고 따뜻한 이웃이에요!”</p><button class="primary-button" id="modalDone">확인</button>`);
      break;
    case "close-post": showToast("모집을 마감했어요. 이미 수락한 참여자와는 계속 진행할 수 있어요."); break;
    case "confirm-order": showToast("주문 내용을 확정했어요. 이제 참여자별 입금이 시작돼요."); setPage("payment"); break;
    case "add-menu":
      openModal(`<div class="eyebrow">ADD YOUR MENU</div><h2 id="modalTitle">메뉴 추가하기</h2><p>채팅방 참여자와 메뉴를 나눠 주문해요.</p>      <div class="form-grid"><div class="form-field full"><label for="menuName">메뉴 이름</label><input id="menuName" placeholder="예: 치즈볼" /></div><div class="form-field"><label for="menuPrice">1개 가격</label><input id="menuPrice" type="number" min="1" placeholder="예: 5000" /></div><div class="form-field"><label for="menuQuantity">수량</label><input id="menuQuantity" type="number" min="1" value="1" /></div></div><button class="primary-button" id="saveMenu">메뉴 추가하기</button>`);
      break;
    case "participant-account": showParticipantAccount(target.dataset.participant); break;
    case "copy-issued-account":
      navigator.clipboard?.writeText(target.dataset.account)
        .then(() => showToast("가상계좌 번호를 복사했어요."))
        .catch(() => showToast(`계좌번호: ${target.dataset.account}`));
      break;
    case "received":
      if (!received.has("서연")) { received.add("서연"); render(); showToast(received.size === 3 ? "모든 참여자가 수령을 확인했어요. 거래가 완료됐어요!" : "수령 완료를 확인했어요."); }
      break;
    case "review":
      rating = 0;
      openModal(`<div class="eyebrow">SHARE YOUR EXPERIENCE</div><h2 id="modalTitle">함께한 이웃을 평가해 주세요</h2><p>서로의 후기는 더 따뜻한 공동배달을 만들어요.</p><div class="rating-stars" id="ratingStars">${[1, 2, 3, 4, 5].map((n) => `<button data-rating="${n}" aria-label="${n}점">★</button>`).join("")}</div><div class="form-field"><label for="reviewText">한 줄 후기</label><textarea id="reviewText" placeholder="함께한 경험을 남겨주세요."></textarea></div><button class="primary-button" id="submitReview">후기 등록하기</button>`);
      break;
    case "edit-profile": showToast("프로필 수정 기능은 준비 중이에요."); break;
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "restaurantId") {
    const form = event.target.form;
    form.querySelector("#menuSelection").innerHTML = menuSelectionMarkup(event.target.value);
    updateCreateOrderSummary(form);
  }
  if (event.target.matches(".sort-select")) {
    sortBy = event.target.value;
    render();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#menuSelection [data-menu-id]")) {
    updateCreateOrderSummary(event.target.form);
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "authForm") {
    await submitAuthForm(event);
    return;
  }
  if (event.target.id === "createForm") {
    event.preventDefault();
    await authInitialization;
    if (!authState.user || !authState.client) {
      showToast("모집글을 등록하려면 먼저 로그인해 주세요.");
      showAuthModal("login");
      return;
    }
    const form = new FormData(event.target);
    const selectedRestaurant = restaurantCatalog.find((restaurant) => restaurant.id === form.get("restaurantId"));
    if (!selectedRestaurant) {
      showToast("음식점을 선택해 주세요.");
      return;
    }
    const selectedMenu = [...event.target.querySelectorAll("[data-menu-id]")]
      .map((input) => ({
        id: input.dataset.menuId,
        name: input.dataset.menuName,
        price: Number(input.dataset.menuPrice),
        quantity: Number(input.value)
      }))
      .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
    if (!selectedMenu.length || selectedMenu.some((item) => item.quantity > 10)) {
      showToast("메뉴를 하나 이상 선택하고 수량을 확인해 주세요.");
      return;
    }
    const currentAmount = selectedMenu.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const payload = {
      owner_id: authState.user.id,
      restaurant_id: selectedRestaurant.id,
      restaurant: selectedRestaurant.name,
      emoji: selectedRestaurant.emoji,
      theme: selectedRestaurant.theme,
      category: selectedRestaurant.category,
      distance_meters: 90,
      joined: 1,
      max_participants: Number.parseInt(String(form.get("members")), 10),
      minimum_amount: selectedRestaurant.minimumOrder,
      current_amount: currentAmount,
      selected_menu: selectedMenu,
      deadline: `${form.get("deadline")} 마감`,
      leader: currentUserName(),
      rating: 4.8,
      trades: 0,
      note: String(form.get("note") || "함께 주문해요!").trim()
    };
    const { data, error } = await authState.client.from("recruitment_posts").insert(payload).select("*").single();
    if (error) {
      showToast(`모집글을 저장하지 못했습니다: ${error.message}`);
      return;
    }
    const newPost = mapRecruitmentPost(data);
    posts.unshift(newPost);
    selectedPost = newPost;
    selectedCategory = "전체";
    setPage("discover");
    showToast("모집글을 등록했어요! 주변 이웃에게 알려드릴게요.");
  }
  if (event.target.id === "chatForm") {
    event.preventDefault();
    const input = event.target.elements.message;
    const message = input.value.trim();
    if (!message) { showToast("메시지를 입력해 주세요."); return; }
    const container = document.querySelector("#chatMessages");
    container.insertAdjacentHTML("beforeend", `<div class="chat-message mine">${avatar(currentUserName())}<div><div class="bubble"></div><span class="message-time">방금</span></div></div>`);
    container.lastElementChild.querySelector(".bubble").textContent = message;
    input.value = "";
    container.scrollTop = container.scrollHeight;
  }
});

document.querySelector("#modalClose").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (event) => { if (event.target === modalBackdrop) closeModal(); });
document.addEventListener("click", (event) => {
  if (event.target.id === "modalDone") closeModal();
  if (event.target.id === "saveMenu") {
    const name = document.querySelector("#menuName").value.trim();
    const price = Number(document.querySelector("#menuPrice").value);
    const quantity = Number(document.querySelector("#menuQuantity").value);
    if (!name || !Number.isFinite(price) || price <= 0 || !Number.isInteger(quantity) || quantity <= 0) { showToast("메뉴 이름, 가격, 수량을 확인해 주세요."); return; }
    customMenu.push({ name: escapeHTML(name), by: currentUserName(), price, quantity });
    closeModal();
    if (currentPage === "chat") render();
    showToast(`${name} 메뉴를 주문 내역에 추가했어요.`);
  }
  if (event.target.dataset.rating) {
    rating = Number(event.target.dataset.rating);
    document.querySelectorAll("#ratingStars button").forEach((star) => star.classList.toggle("selected", Number(star.dataset.rating) <= rating));
  }
  if (event.target.id === "submitReview") {
    if (!rating) { showToast("별점을 선택해 주세요."); return; }
    closeModal();
    showToast("소중한 후기를 등록했어요. 고마워요!");
  }
});

document.querySelector("#helpButton").addEventListener("click", () => {
  openModal(`<div class="eyebrow">HOW IT WORKS</div><h2 id="modalTitle">모아먹자, 이렇게 이용해요</h2><p>① 내 주변 모집글을 둘러봐요.<br />② 마음에 드는 모집글에 동참 신청해요.<br />③ 리더가 수락하면 채팅방에서 메뉴를 정해요.<br />④ 각자 금액을 입금하고 맛있게 나눠 먹어요.<br />⑤ 음식을 받으면 수령 확인 후 서로를 평가해요.</p><button class="primary-button" id="modalDone">좋아요!</button>`);
});

document.querySelector(".brand").addEventListener("click", (event) => { event.preventDefault(); setPage("discover"); });
if (new URLSearchParams(window.location.search).get("page") === "payment") {
  setPage("payment");
  showToast("가상계좌 상태를 불러왔어요.");
} else {
  render();
}
authInitialization = initializeAuth();
