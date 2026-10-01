const posts = [];
const applications = [];
const menuSelections = [];
const chatMessages = [];
const receiptConfirmations = [];
let groupRealtimeChannel = null;

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
let rating = 0;
const virtualAccounts = new Map();
let virtualAccountError = "";
let accountRefreshTimer = null;
let paymentGroup = null;
let paymentGroupId = null;
let authInitialization = Promise.resolve();
let passwordRecoveryShown = false;
const authState = { client: null, user: null, error: "" };
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
    deadlineAt: row.deadline_at || legacyDeadlineAt(row),
    paymentsStartedAt: row.payments_started_at || null,
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

async function loadMenuSelections() {
  menuSelections.splice(0, menuSelections.length);
  if (!authState.client || !authState.user) return;
  const { data, error } = await authState.client
    .from("recruitment_menu_selections")
    .select("application_id, post_id, applicant_name, selected_menu, amount")
    .order("updated_at", { ascending: true });
  if (error) throw error;
  menuSelections.push(...data);
}

function getActiveGroupPost() {
  if (selectedPost && (isPostOwner(selectedPost) || applications.some((application) =>
    application.post_id === selectedPost.id
    && application.applicant_id === authState.user?.id
    && application.status === "approved"))) {
    return selectedPost;
  }
  return posts.find((post) => isPostOwner(post) || applications.some((application) =>
    application.post_id === post.id
    && application.applicant_id === authState.user?.id
    && application.status === "approved")) || null;
}

async function loadGroupData(post = getActiveGroupPost()) {
  chatMessages.splice(0, chatMessages.length);
  receiptConfirmations.splice(0, receiptConfirmations.length);
  if (!post || !authState.client || !authState.user) return;
  const [messagesResult, receiptsResult] = await Promise.all([
    authState.client.from("recruitment_messages")
      .select("id, post_id, sender_id, sender_name, body, created_at")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true }),
    authState.client.from("recruitment_receipts")
      .select("user_id, participant_name, created_at")
      .eq("post_id", post.id)
      .order("created_at", { ascending: true })
  ]);
  if (messagesResult.error) throw messagesResult.error;
  if (receiptsResult.error) throw receiptsResult.error;
  chatMessages.push(...messagesResult.data);
  receiptConfirmations.push(...receiptsResult.data);
}

async function refreshRecruitmentData() {
  await loadRecruitmentPosts();
  await loadApplications();
  await loadMenuSelections();
  if (authState.user) await loadGroupData();
  if (selectedPost) selectedPost = posts.find((post) => post.id === selectedPost.id) || null;
  if (currentPage === "detail" && !selectedPost) currentPage = "discover";
  render();
}

function remainingTime(deadlineAt) {
  const time = Date.parse(deadlineAt || "");
  if (!Number.isFinite(time)) return "마감 시간 정보 없음";
  const remaining = time - Date.now();
  if (remaining <= 0) return "모집 마감";
  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const restMinutes = minutes % 60;
  if (days) return `${days}일 ${hours}시간 남음`;
  if (hours) return `${hours}시간 ${restMinutes}분 남음`;
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${restMinutes}분 ${seconds}초 남음`;
}

function updateDeadlineCountdowns() {
  let deadlineJustExpired = false;
  document.querySelectorAll("[data-deadline-at]").forEach((element) => {
    const expired = remainingTime(element.dataset.deadlineAt) === "모집 마감";
    if (expired && !element.classList.contains("deadline-expired")) deadlineJustExpired = true;
    element.textContent = expired ? "모집 마감" : remainingTime(element.dataset.deadlineAt);
    element.classList.toggle("deadline-expired", expired);
  });
  if (deadlineJustExpired && ["detail", "applicants", "delivery"].includes(currentPage)) render();
}

const won = (value) => `${value.toLocaleString("ko-KR")}원`;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const avatarClass = (name) => ({ 서연: "avatar-me", 민지: "avatar-purple", 준호: "avatar-blue", 하은: "avatar-pink", 도윤: "avatar-purple", 유진: "avatar-pink", 시우: "avatar-blue" }[name] || "avatar-purple");
const avatar = (name, large = false) => `<span class="avatar ${large ? "avatar-large" : avatarClass(name)}">${escapeHTML(name.slice(0, 1))}</span>`;
const currentUserName = () => authState.user ? authDisplayName() : "게스트";
const isPostOwner = (post) => post.ownerId === (authState.user?.id || "guest");

function legacyDeadlineAt(row) {
  const minutes = Number.parseInt(String(row.deadline || "").match(/\d+/)?.[0] || "", 10);
  const createdAt = Date.parse(row.created_at || "");
  return Number.isFinite(minutes) && Number.isFinite(createdAt)
    ? new Date(createdAt + minutes * 60_000).toISOString()
    : null;
}

function menuSelectionMarkup(restaurantId, selectedItems = []) {
  const restaurant = restaurantCatalog.find((entry) => entry.id === restaurantId);
  if (!restaurant) return `<p class="subheading">먼저 음식점을 선택해 주세요.</p>`;
  return restaurant.menu.map((item) => `<label class="menu-choice">
    <span><strong>${escapeHTML(item.name)}</strong><small>${won(item.price)}</small></span>
    <input type="number" name="menu-${escapeHTML(item.id)}" data-menu-id="${escapeHTML(item.id)}" data-menu-name="${escapeHTML(item.name)}" data-menu-price="${item.price}" min="0" max="10" value="${selectedItems.find((selected) => selected.id === item.id)?.quantity || 0}" aria-label="${escapeHTML(item.name)} 수량" />
  </label>`).join("");
}

function participantMenuFormMarkup(post, application) {
  if (post.paymentsStartedAt) {
    return `<div class="participant-menu"><h3>내 메뉴 선택</h3><p class="subheading">입금이 시작되어 메뉴가 확정됐어요.</p></div>`;
  }
  if (!restaurantCatalog.some((restaurant) => restaurant.id === post.restaurantId)) {
    return `<div class="participant-menu"><h3>내 메뉴 선택</h3><p class="subheading">이 모집글은 메뉴 선택 기능이 추가되기 전에 등록되어 메뉴 선택을 지원하지 않습니다.</p></div>`;
  }
  const selection = menuSelections.find((item) => item.application_id === application.id);
  return `<form id="participantMenuForm" class="participant-menu">
    <h3>내 메뉴 선택</h3><p class="subheading">신청이 승인됐어요. 메뉴와 수량을 선택해 주문에 추가하세요.</p>
    <div class="menu-selection">${menuSelectionMarkup(post.restaurantId, selection?.selected_menu || [])}</div>
    <div class="participant-menu-total">내 메뉴 합계 <strong id="participantMenuTotal">${won(selection?.amount || 0)}</strong></div>
    <button class="primary-button" type="submit">내 메뉴 저장</button>
  </form>`;
}

function participantOrdersMarkup(post) {
  const selections = menuSelections.filter((selection) => selection.post_id === post.id);
  return `<div class="detail-block"><h3>참가자 메뉴</h3>${selections.length
    ? selections.map((selection) => `<div class="participant-order"><strong>${escapeHTML(selection.applicant_name)}</strong>${selection.selected_menu.map((item) => `<p>${escapeHTML(item.name)} × ${item.quantity} · ${won(item.price * item.quantity)}</p>`).join("")}</div>`).join("")
    : `<p>승인된 참가자가 메뉴를 선택하면 여기에 표시돼요.</p>`}</div>`;
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

function updateParticipantMenuTotal(form) {
  const total = [...form.querySelectorAll("[data-menu-id]")]
    .reduce((sum, input) => sum + Number(input.dataset.menuPrice) * Number(input.value), 0);
  form.querySelector("#participantMenuTotal").textContent = won(total);
}

function groupParticipants(post = getActiveGroupPost()) {
  if (!post) return [];
  const participants = [];
  if (post.ownerId) {
    participants.push({
      id: post.ownerId,
      name: post.leader,
      role: "리더",
      amount: (post.selectedMenu || []).reduce((sum, item) => sum + item.price * item.quantity, 0)
    });
  }
  for (const application of applications.filter((item) => item.post_id === post.id && item.status === "approved")) {
    const selection = menuSelections.find((item) => item.application_id === application.id);
    participants.push({
      id: application.applicant_id,
      name: application.applicant_name,
      role: "참여자",
      amount: selection?.amount || 0,
      application
    });
  }
  return participants;
}

function groupOrderLines(post) {
  return [
    ...(post.selectedMenu || []).map((item) => ({ ...item, by: post.leader })),
    ...menuSelections.filter((selection) => selection.post_id === post.id)
      .flatMap((selection) => selection.selected_menu.map((item) => ({ ...item, by: selection.applicant_name })))
  ];
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
  if (["chat", "payment", "delivery"].includes(page)) {
    const activePost = getActiveGroupPost();
    if (!activePost) {
      showToast("이용하려면 로그인하고 모집글을 만들거나 참여 승인을 받아야 해요.");
      page = "discover";
    } else {
      selectedPost = activePost;
    }
  }
  if (groupRealtimeChannel) {
    void authState.client?.removeChannel(groupRealtimeChannel);
    groupRealtimeChannel = null;
  }
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  render();
  if (["chat", "payment", "delivery"].includes(page) && selectedPost && authState.client) {
    void loadGroupData(selectedPost).then(() => {
      if (currentPage === page) render();
    }).catch((error) => showToast(`공동 주문 정보를 불러오지 못했습니다: ${error.message}`));
    const postId = selectedPost.id;
    groupRealtimeChannel = authState.client.channel(`recruitment-group-${postId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "recruitment_messages", filter: `post_id=eq.${postId}` }, () => {
        void loadGroupData(selectedPost).then(render).catch((error) => showToast(`채팅 내용을 새로고침하지 못했습니다: ${error.message}`));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "recruitment_menu_selections", filter: `post_id=eq.${postId}` }, () => {
        void refreshRecruitmentData().then(() => currentPage === "payment" && refreshVirtualAccounts())
          .catch((error) => showToast(`주문 정보를 새로고침하지 못했습니다: ${error.message}`));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "recruitment_applications", filter: `post_id=eq.${postId}` }, () => {
        void refreshRecruitmentData().catch((error) => showToast(`참여자 정보를 새로고침하지 못했습니다: ${error.message}`));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "recruitment_receipts", filter: `post_id=eq.${postId}` }, () => {
        void loadGroupData(selectedPost).then(render).catch((error) => showToast(`수령 확인을 새로고침하지 못했습니다: ${error.message}`));
      })
      .subscribe();
  }
  if (["chat", "payment", "delivery"].includes(page)) {
    void refreshVirtualAccounts();
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
    <div class="post-meta"><span class="member-count"><b>${post.joined}</b> / ${post.max}명 모집 중</span><span class="post-deadline">◷ <span data-deadline-at="${escapeHTML(post.deadlineAt || "")}">${remainingTime(post.deadlineAt)}</span></span></div>
    <div class="post-money"><span>현재 모인 금액</span><strong>${won(post.amount)}</strong></div>
    <div class="post-money"><span>최소주문까지</span><strong class="money-need">${won(Math.max(post.minimum - post.amount, 0))} 남음</strong></div>
    <div class="leader-line">${avatar(post.leader)}<span>${escapeHTML(post.leader)} 리더</span><span class="leader-rating"><b class="star">★</b> ${escapeHTML(post.rating)} · 거래 ${post.trades}회</span></div>
  </article>`;
}

function discoverPage() {
  const visible = posts
    .filter((post) => post.distance <= 300)
    .filter((post) => !post.deadlineAt || Date.parse(post.deadlineAt) > Date.now())
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
  const expired = post.deadlineAt && Date.parse(post.deadlineAt) <= Date.now();
  return `<div class="page-heading"><div><div class="eyebrow">GROUP ORDER · ${post.distance}M AWAY</div><h1>모집글 상세</h1><p class="subheading">함께 주문할 이웃과 자세한 내용을 확인해요.</p></div><button class="secondary-button" data-page="discover">← 목록으로</button></div>
    <div class="detail-layout"><section class="page-card">
      <div class="detail-food"><div class="food-thumb ${escapeHTML(post.theme)}">${escapeHTML(post.emoji)}</div><div><span class="tag">${escapeHTML(post.category)}</span><h2>${escapeHTML(post.restaurant)}</h2><p>⌖ 내 위치에서 ${post.distance}m · 배달 예정 약 40분</p></div></div>
      <div class="detail-stats"><div class="detail-stat"><small>모집 인원</small><strong>${post.joined} / ${post.max}명</strong></div><div class="detail-stat"><small>최소주문금액</small><strong>${won(post.minimum)}</strong></div><div class="detail-stat"><small>현재 주문금액</small><strong>${won(post.amount)}</strong></div></div>
      ${post.selectedMenu?.length ? `<div class="detail-block"><h3>선택한 메뉴</h3>${post.selectedMenu.map((item) => `<p>${escapeHTML(item.name)} × ${item.quantity} · ${won(item.price * item.quantity)}</p>`).join("")}</div>` : ""}
      ${(isOwner || applicationStatus === "approved") ? participantOrdersMarkup(post) : ""}
      ${!isOwner && applicationStatus === "approved" ? participantMenuFormMarkup(post, myApplication) : ""}
      <div class="detail-block"><h3>리더의 한마디</h3><p>${escapeHTML(post.note)}</p></div>
      <div class="detail-block"><h3>모집 안내</h3><p>${post.deadline === "조기 마감" ? "리더가 모집을 조기 마감했어요" : `모집 마감 ${escapeHTML(post.deadline)}`} · <strong data-deadline-at="${escapeHTML(post.deadlineAt || "")}">${remainingTime(post.deadlineAt)}</strong><br />승인된 참가자는 이 화면에서 메뉴를 선택할 수 있어요. 만남 장소와 수령 시간은 채팅으로 조율해요.</p></div>
    </section><aside class="page-card"><div class="section-title"><h2>리더 정보</h2><button class="text-button" data-action="leader-profile">프로필 보기</button></div>
      <div class="leader-card">${avatar(post.leader, true)}<div class="leader-info"><strong>${escapeHTML(post.leader)}</strong><small>따뜻한 한 끼를 함께해요</small></div></div>
      <div class="reputation-row"><div><strong><span class="star">★</span> ${post.rating}</strong>평점</div><div><strong>${post.trades}회</strong>거래 횟수</div><div><strong>100%</strong>매너 온도</div></div>
      <div class="detail-block"><h3>최소주문까지</h3><p style="color:#e68b5d;font-weight:700;font-size:15px">${won(Math.max(post.minimum - post.amount, 0))} 남았어요</p></div>
      ${isOwner
        ? `<button class="primary-button" style="width:100%;margin-top:17px" data-page="applicants">신청자 관리</button>${expired ? "" : `<button class="secondary-button" style="width:100%;margin-top:9px" data-action="close-post">모집 조기 마감</button>`}${post.paymentsStartedAt ? `<div class="join-note">입금이 시작된 모집글은 삭제할 수 없어요.</div>` : `<button class="danger-button" style="width:100%;margin-top:9px" data-action="delete-post">모집글 삭제</button>`}<div class="join-note">내가 만든 모집글이에요. 신청할 수 없습니다.</div>`
        : `<button class="primary-button" style="width:100%;margin-top:17px" data-action="apply" ${applicationStatus === "pending" ? "" : full || expired || applicationStatus === "approved" || applicationStatus === "rejected" ? "disabled" : ""}>${applicationStatus === "pending" ? "신청 취소하기" : applicationStatus === "approved" ? "신청 승인됨" : applicationStatus === "rejected" ? "신청 거절됨" : !authState.user ? "로그인 후 신청" : expired ? "모집 마감" : full ? "모집 인원 마감" : "동참 신청하기"} <span>→</span></button>
      <div class="join-note">${applicationStatus === "pending" ? "리더의 승인을 기다리고 있어요." : applicationStatus === "approved" ? "모집자가 참여 신청을 승인했어요." : applicationStatus === "rejected" ? "이번 모집글 신청이 거절되었어요." : expired ? post.deadline === "조기 마감" ? "리더가 모집을 조기 마감했어요." : "모집 마감 시간이 지났어요." : full ? "모집 인원이 모두 찼어요." : !authState.user ? "신청하려면 로그인해 주세요." : "신청 후 리더의 승인을 기다려요."}</div>`}
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
        <div class="form-field"><label for="deadline">모집 마감 시간 *</label><select id="deadline" name="deadline"><option value="15">15분 후</option><option value="30">30분 후</option><option value="60">1시간 후</option><option value="custom">직접 설정</option></select><input id="customDeadline" name="customDeadline" type="datetime-local" aria-label="모집 마감 날짜와 시간" hidden /></div>
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
        const postExpired = Date.parse(post.deadlineAt || "") <= Date.now();
        return `<article class="page-card owned-post-card"><div class="section-title"><h2>${escapeHTML(post.restaurant)}</h2><span class="tag">${escapeHTML(post.category)}</span></div><p class="subheading">${post.deadline === "조기 마감" ? "리더가 조기 마감했어요" : escapeHTML(post.deadline)} · <span data-deadline-at="${escapeHTML(post.deadlineAt || "")}">${remainingTime(post.deadlineAt)}</span> · 참여 ${post.joined} / ${post.max}명</p>
          ${postApplications.length
            ? postApplications.map((application) => `<div class="applicant-row"><span class="avatar">${escapeHTML(application.applicant_name.slice(0, 1))}</span><div class="applicant-copy"><strong>${escapeHTML(application.applicant_name)}</strong><small>${application.status === "pending" ? postExpired ? "마감되어 더 이상 승인할 수 없어요." : "참여 신청을 보냈어요." : application.status === "approved" ? "신청을 승인했어요." : "신청을 거절했어요."}</small></div><div class="applicant-actions">${application.status === "pending" ? `<button class="primary-button" data-action="review-application" data-application-id="${application.id}" data-decision="approved" ${postExpired ? "disabled" : ""}>승인</button><button class="secondary-button" data-action="review-application" data-application-id="${application.id}" data-decision="rejected">거절</button>` : `<span class="status-pill ${application.status === "approved" ? "status-paid" : "status-pending"}">${application.status === "approved" ? "승인됨" : "거절됨"}</span>`}</div></div>`).join("")
            : `<p class="subheading">아직 신청한 사람이 없어요.</p>`}
          <div class="owned-post-actions"><button class="secondary-button" data-action="manage-owned-post" data-post-id="${post.id}">모집글 확인</button>${Date.parse(post.deadlineAt || "") > Date.now() ? `<button class="secondary-button" data-action="close-post" data-post-id="${post.id}">조기 마감</button>` : ""}${post.paymentsStartedAt ? `<span class="join-note">입금 중 · 삭제 불가</span>` : `<button class="danger-button" data-action="delete-post" data-post-id="${post.id}">삭제</button>`}</div></article>`;
      }).join("")}</section>`
      : `<section class="page-card"><div class="empty-state">아직 등록한 모집글이 없어요.<br />모집글을 만들면 이곳에서 신청자를 확인할 수 있어요.<br /><button class="primary-button" style="margin-top:16px" data-page="create">모집글 만들기</button></div></section>`}`;
}

async function refreshVirtualAccounts() {
  if (!["chat", "payment", "delivery"].includes(currentPage)) return;
  const post = getActiveGroupPost();
  const session = (await authState.client?.auth.getSession())?.data.session;
  if (!post || !session) {
    virtualAccounts.clear();
    paymentGroup = null;
    paymentGroupId = null;
    virtualAccountError = "";
    render();
    return;
  }
  if (paymentGroupId !== post.id) {
    virtualAccounts.clear();
    paid.clear();
    paymentGroup = null;
    paymentGroupId = post.id;
  }
  try {
    const response = await fetch(`/api/virtual-accounts?groupId=${encodeURIComponent(post.id)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    const result = await readApiResponse(response, "입금 상태를 불러오지 못했어요.");
    virtualAccounts.clear();
    for (const account of result.accounts) virtualAccounts.set(account.participantId, account);
    paymentGroup = result.group;
    paid = new Set(result.accounts.filter((account) => account.status === "PAID").map((account) => account.participantId));
    virtualAccountError = "";
    if (["chat", "payment", "delivery"].includes(currentPage)) render();
  } catch (error) {
    virtualAccountError = error.message.includes("Failed to fetch")
      ? "Vercel 배포에서 API를 사용하고 Toss·Upstash 환경 변수를 설정해 주세요."
      : error.message;
    if (["chat", "payment", "delivery"].includes(currentPage)) render();
  }
}

async function showParticipantAccount(participantId) {
  const post = getActiveGroupPost();
  const session = (await authState.client?.auth.getSession())?.data.session;
  if (!post || !session || participantId !== authState.user?.id) {
    showToast("본인의 로그인된 참여자 계좌만 발급할 수 있어요.");
    return;
  }
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
    if (existing && !["NOT_ISSUED", "FAILED", "EXPIRED", "CANCELED"].includes(existing.status)) {
      response = await fetch(`/api/virtual-accounts?groupId=${encodeURIComponent(post.id)}&participantId=${encodeURIComponent(participantId)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
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
      const accountOwner = groupParticipants(post).find((person) => person.id === participantId)?.name || currentUserName();
      openModal(`<div class="eyebrow">TOSS TEST VIRTUAL ACCOUNT</div><h2 id="modalTitle">${escapeHTML(accountOwner)}님의 가상계좌</h2><p>아래 계좌는 이 참여자의 분담액 전용입니다. 정확한 금액으로 입금해 주세요.</p><div class="issued-account-card"><strong>${escapeHTML(bankName)}</strong>${accountNumber}<span>입금 금액 <b>${won(account.amount)}</b></span><span>입금 상태 <b>${account.status === "PAID" ? "입금 완료" : "입금 대기"}</b></span><span>입금 기한 <b>${escapeHTML(account.dueDate || "토스페이먼츠 안내 시간")}</b></span></div><button class="primary-button" id="modalDone">확인</button>`);
      return;
    } else {
      response = await fetch("/api/virtual-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ groupId: post.id, participantId })
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "abandon", groupId: post.id, participantId, orderId: checkoutOrderId })
      });
      virtualAccounts.set(participantId, { participantId, participantName: participantId, status: "FAILED" });
    }
    render();
    showToast(error.message);
  }
}

function chatPage() {
  const post = getActiveGroupPost();
  if (!post) return groupPageEmptyState("공동 채팅방", "채팅에 참여하려면 모집글을 만들거나 참여 신청이 승인되어야 해요.");
  const people = groupParticipants(post);
  const lines = groupOrderLines(post);
  const userApplication = applications.find((item) => item.post_id === post.id && item.applicant_id === authState.user?.id && item.status === "approved");
  const allMenusChosen = Boolean(post.selectedMenu?.length) && people.filter((person) => person.application)
    .every((person) => menuSelections.some((selection) => selection.application_id === person.application.id));
  const menuLines = lines.length
    ? lines.map((item) => `<div class="order-line"><span>${escapeHTML(item.by)} · ${escapeHTML(item.name)}${item.quantity > 1 ? ` × ${item.quantity}` : ""}</span><strong>${won(item.price * item.quantity)}</strong></div>`).join("")
    : `<p class="subheading">리더와 참가자가 메뉴를 선택하면 주문 내역에 표시돼요.</p>`;
  return `<div class="page-heading"><div><div class="eyebrow">GROUP ROOM · ${people.length}명 참여 중</div><h1>${escapeHTML(post.restaurant)} 공동 주문</h1><p class="subheading">모집 마감 <span data-deadline-at="${escapeHTML(post.deadlineAt || "")}">${remainingTime(post.deadlineAt)}</span></p></div><button class="secondary-button" data-page="payment">입금 현황 →</button></div>
    <div class="chat-layout"><section class="chat-panel"><div class="chat-header"><div><strong>${escapeHTML(post.emoji)} ${escapeHTML(post.restaurant)}</strong><small>${people.map((person) => escapeHTML(person.name)).join(", ")}</small></div><div class="online-dots">${people.map((person) => avatar(person.name)).join("")}</div></div>
      <div class="chat-status">● ${allMenusChosen ? "메뉴 결정 완료" : "메뉴 결정 중"} <span style="color:#a1aaa4">　→　입금 ${paymentGroup?.status === "ORDER_READY" ? "완료" : "대기"}</span></div>
      <div class="chat-messages" id="chatMessages">${chatMessages.length ? chatMessages.map((message) => `<div class="chat-message ${message.sender_id === authState.user?.id ? "mine" : ""}">${avatar(message.sender_name)}<div><div class="bubble">${escapeHTML(message.body)}</div><span class="message-time">${new Date(message.created_at).toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span></div></div>`).join("") : `<div class="empty-state">아직 채팅이 없어요. 첫 메시지를 보내 보세요.</div>`}</div>
      ${userApplication || isPostOwner(post) ? `<form id="chatForm" class="chat-input"><input name="message" maxlength="1000" required placeholder="메시지를 입력해 주세요..." /><button aria-label="메시지 보내기">↑</button></form>` : `<p class="join-note">승인된 참가자만 채팅을 보낼 수 있어요.</p>`}
    </section><aside><section class="page-card"><div class="section-title"><h2>현재 주문 내역</h2></div><div class="menu-order">${menuLines}<div class="order-total"><span>총 주문금액</span><strong>${won(lines.reduce((total, item) => total + item.price * item.quantity, 0))}</strong></div></div>
      ${userApplication && !menuSelections.some((selection) => selection.application_id === userApplication.id) ? `<button class="secondary-button" style="width:100%;margin-top:15px" data-action="open-own-menu">내 메뉴 선택하기</button>` : ""}
      <button class="primary-button" style="width:100%;margin-top:15px" data-page="payment" ${!allMenusChosen ? "disabled" : ""}>입금 현황 보기</button></section>
      <section class="page-card" style="margin-top:13px"><div class="section-title"><h2>참여자</h2></div>${people.map((person) => {
        const selection = menuSelections.find((item) => item.applicant_id === person.id && item.post_id === post.id);
        return `<div class="participant-row">${avatar(person.name)}<div class="participant-copy"><strong>${escapeHTML(person.name)}${person.id === authState.user?.id ? " (나)" : ""}</strong><small>${person.role}</small></div><span class="status-pill ${selection || (!person.application && post.selectedMenu?.length) ? "status-paid" : "status-pending"}">${selection || (!person.application && post.selectedMenu?.length) ? "메뉴 선택" : "메뉴 대기"}</span></div>`;
      }).join("")}</section></aside></div>`;
}

function paymentPage() {
  const post = getActiveGroupPost();
  if (!post) return groupPageEmptyState("입금 현황", "입금 내역을 보려면 모집글을 만들거나 참여 신청이 승인되어야 해요.");
  const people = groupParticipants(post);
  const total = people.reduce((sum, person) => sum + person.amount, 0);
  const paidTotal = people.filter((person) => virtualAccounts.get(person.id)?.status === "PAID").reduce((sum, person) => sum + person.amount, 0);
  const paidCount = people.filter((person) => virtualAccounts.get(person.id)?.status === "PAID").length;
  const allPaid = people.length > 0 && paidCount === people.length;
  const menusReady = people.every((person) => person.amount > 0);
  const groupOpen = !paymentGroup || paymentGroup.status === "COLLECTING";
  return `<div class="page-heading"><div><div class="eyebrow">PARTICIPANT VIRTUAL ACCOUNTS</div><h1>함께 입금하기</h1><p class="subheading">${escapeHTML(post.restaurant)} · 각자 선택한 메뉴 금액을 부담해요.</p></div><button class="secondary-button" data-page="chat">← 채팅방</button></div>
    <div class="detail-layout"><section class="page-card"><div class="payment-total"><small>총 결제 예정 금액</small><strong>${won(total)}</strong></div><div class="section-title" style="margin-top:22px"><h2>입금 현황</h2><span class="subheading">${paidCount} / ${people.length}명 완료</span></div>
      ${!menusReady ? `<div class="account-info-box"><strong>메뉴 선택을 기다리고 있어요</strong><span>리더와 승인된 참가자가 메뉴를 선택하면 각자의 분담 금액이 표시됩니다.</span></div>` : people.map((person) => {
        const account = virtualAccounts.get(person.id);
        const status = account?.status || "NOT_ISSUED";
        const paidStatus = status === "PAID";
        const statusLabel = paidStatus ? "입금 완료"
          : status === "REFUND_REQUESTED" ? "환불 처리 중"
            : status === "REFUND_ACTION_REQUIRED" ? "환불 확인 필요"
              : status === "CANCEL_REQUESTING" ? "취소 처리 중"
                : status === "EXPIRED" || status === "CANCELED" || status === "FAILED" ? "발급 종료"
                  : status === "WAITING_FOR_DEPOSIT" ? "입금 대기"
                    : status === "REQUESTING" ? "발급 처리 중" : "계좌 미발급";
        const canIssue = status === "NOT_ISSUED" || status === "FAILED" || status === "EXPIRED" || status === "CANCELED";
        const isMe = person.id === authState.user?.id;
        const showAction = isMe && canIssue && groupOpen;
        const actionLabel = canIssue ? "계좌 발급" : "계좌 확인";
        return `<div class="participant-row payment-participant">${avatar(person.name)}<div class="participant-copy"><strong>${escapeHTML(person.name)}${isMe ? " (나)" : ""}</strong><small>${person.role} · ${won(person.amount)}</small></div><span class="status-pill ${paidStatus ? "status-paid" : "status-pending"}">${statusLabel}</span>${showAction ? `<button class="secondary-button account-action" data-action="participant-account" data-participant="${person.id}">${actionLabel}</button>` : isMe && !canIssue && status !== "REQUESTING" ? `<button class="secondary-button account-action" data-action="participant-account" data-participant="${person.id}">계좌 확인</button>` : ""}</div>`;
      }).join("")}
      <div class="progress-track"><div class="progress-fill" style="width:${total ? Math.round((paidTotal / total) * 100) : 0}%"></div></div><div class="progress-caption"><span>입금 완료 금액 ${won(paidTotal)}</span><span>${total ? Math.round((paidTotal / total) * 100) : 0}%</span></div>
    </section><aside class="page-card"><div class="section-title"><h2>참여자별 가상계좌</h2><span class="tag">Toss 테스트</span></div><p class="subheading">본인 계좌만 발급·확인할 수 있으며, 실제 입금은 Toss 테스트 계좌에서 진행됩니다.</p>
      <div class="account-info-box">${virtualAccountError ? `<strong>연동 설정이 필요해요</strong><span>${escapeHTML(virtualAccountError)}</span>` : paymentGroup?.status === "COLLECTING" ? `<strong>입금 마감 ${new Date(paymentGroup.deadlineAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</strong><span>마감까지 전원이 입금하지 않으면 공동배달은 자동 취소됩니다.</span>` : paymentGroup?.status === "ORDER_READY" ? "<strong>모든 참여자의 입금이 완료됐어요</strong><span>배달 플랫폼 주문·배송 정보는 별도 연동이 필요합니다.</span>" : paymentGroup?.status === "CANCELLING" ? "<strong>공동배달 취소 처리 중</strong><span>미입금 계좌를 취소하고 입금된 금액의 환불을 요청하고 있어요.</span>" : paymentGroup?.status === "REFUND_ACTION_REQUIRED" ? "<strong>환불 계좌 확인이 필요해요</strong><span>토스 결제내역에서 입금 결제의 환불 정보를 확인해 주세요.</span>" : paymentGroup?.status === "REFUNDING" ? "<strong>공동배달이 취소됐어요</strong><span>환불을 요청했습니다. 은행 처리에는 영업일 기준 시간이 걸릴 수 있어요.</span>" : paymentGroup?.status === "CANCELED" ? "<strong>공동배달이 취소됐어요</strong><span>입금 마감까지 전원이 입금하지 않아 미입금 계좌를 취소했어요.</span>" : menusReady ? "<strong>개인별 메뉴 금액을 확인해 주세요</strong><span>첫 참여자가 계좌 발급을 시작하면 1시간 입금 마감이 시작됩니다.</span>" : "<strong>메뉴 선택 대기 중</strong><span>모든 참여자가 메뉴를 선택한 후 계좌를 발급할 수 있습니다.</span>"}</div>
      <div class="account-info-box refund-notice"><strong>환불 계좌 안내</strong><span>자동 환불을 위해 Toss 결제창에서 환불 계좌 입력을 지원하도록 설정해야 합니다.</span></div>
    </aside></div>`;
}

function deliveryPage() {
  const post = getActiveGroupPost();
  if (!post) return groupPageEmptyState("진행 상황", "진행 상황을 보려면 모집글을 만들거나 참여 신청이 승인되어야 해요.");
  const people = groupParticipants(post);
  const menusReady = Boolean(post.selectedMenu?.length) && people.filter((person) => person.application)
    .every((person) => menuSelections.some((selection) => selection.application_id === person.application.id));
  const allPaid = paymentGroup?.status === "ORDER_READY";
  const receiptCount = receiptConfirmations.length;
  const progressMessage = allPaid
    ? "모든 참여자의 입금이 완료됐어요."
    : paymentGroup?.status === "COLLECTING"
      ? "참여자별 Toss 가상계좌 입금을 기다리고 있어요."
      : paymentGroup?.status === "PREPARING"
        ? "공동 입금을 준비하고 있어요."
        : paymentGroup?.status === "CANCELLING"
          ? "미입금 계좌 취소와 환불을 처리하고 있어요."
          : paymentGroup?.status === "REFUND_ACTION_REQUIRED"
            ? "환불 계좌 확인이 필요해요. Toss 결제 내역을 확인해 주세요."
            : paymentGroup?.status === "REFUNDING"
              ? "공동 주문이 취소됐고 환불을 처리하고 있어요."
              : paymentGroup?.status === "CANCELED"
                ? "공동 주문 결제가 취소됐어요."
                : menusReady
                  ? "참가자 메뉴 선택 완료 후 입금을 진행할 수 있어요."
                  : "참가자 메뉴 선택을 기다리고 있어요.";
  const progressDescription = allPaid
    ? "배달 상태를 임의로 추정하지 않습니다. 실제 수령 후 아래에서 확인해 주세요."
    : "모집글, 참가자 메뉴 선택, Toss 가상계좌 입금 상태를 연결해 표시합니다.";
  const currentUserReceived = receiptConfirmations.some((receipt) => receipt.user_id === authState.user?.id);
  const receiptAction = currentUserReceived
    ? `<p class="join-note">수령을 확인했어요.</p>`
    : allPaid
      ? `<button class="primary-button" style="width:100%;margin-top:13px" data-action="received">수령 완료하기</button>`
      : `<p class="join-note">모든 참여자의 입금이 완료된 뒤 수령을 확인할 수 있어요.</p>`;
  const steps = ["모집 마감", "메뉴 선택 완료", "입금 시작", "입금 완료", "배달 정보", "수령 확인"];
  const completed = [
    people.length >= post.max || Date.parse(post.deadlineAt || "") <= Date.now(),
    menusReady,
    Boolean(paymentGroup),
    allPaid,
    false,
    people.length > 0 && receiptCount === people.length
  ];
  const activeIndex = completed.findIndex((done) => !done);
  return `<div class="page-heading"><div><div class="eyebrow">ORDER TRACKING</div><h1>공동배달 진행 상황</h1><p class="subheading">${escapeHTML(post.restaurant)} · <span data-deadline-at="${escapeHTML(post.deadlineAt || "")}">${remainingTime(post.deadlineAt)}</span></p></div><button class="secondary-button" data-page="chat">채팅방에서 조율하기</button></div>
    <section class="page-card"><div class="section-title"><h2>주문 단계</h2><span class="status-pill ${allPaid ? "status-paid" : "status-pending"}">${allPaid ? "입금 완료" : "진행 중"}</span></div>
      <div class="timeline">${steps.map((step, index) => `<div class="timeline-step ${completed[index] ? "done" : index === activeIndex ? "current" : ""}"><div class="step-dot">${completed[index] ? "✓" : index + 1}</div>${step}</div>`).join("")}</div>
      <div class="delivery-summary"><div class="summary-tile"><small>모집 인원</small><strong>${post.joined} / ${post.max}명</strong></div><div class="summary-tile"><small>메뉴 합계</small><strong>${won(groupParticipants(post).reduce((sum, person) => sum + person.amount, 0))}</strong></div><div class="summary-tile"><small>입금 상태</small><strong>${allPaid ? "전원 입금 완료" : `${paid.size} / ${people.length}명 입금 완료`}</strong></div><div class="summary-tile"><small>수령 확인</small><strong>${receiptCount} / ${people.length}명</strong></div></div>
      <div class="account-info-box"><strong>${escapeHTML(progressMessage)}</strong><span>${escapeHTML(progressDescription)}</span></div>
    </section><div class="detail-layout" style="margin-top:15px"><section class="page-card"><div class="section-title"><h2>음식 수령 확인</h2><span class="subheading">${receiptCount} / ${people.length}명</span></div><p class="subheading">실제로 음식을 받은 뒤 수령 완료를 눌러주세요.</p>${people.map((person) => {
      const receivedByPerson = receiptConfirmations.some((receipt) => receipt.user_id === person.id);
      return `<div class="participant-row">${avatar(person.name)}<div class="participant-copy"><strong>${escapeHTML(person.name)}${person.id === authState.user?.id ? " (나)" : ""}</strong><small>${person.role}</small></div><span class="status-pill ${receivedByPerson ? "status-paid" : "status-pending"}">${receivedByPerson ? "수령 확인" : "대기 중"}</span></div>`;
    }).join("")}${receiptAction}</section>
    <aside class="page-card"><div class="section-title"><h2>현재 주문 내역</h2></div>${groupOrderLines(post).map((item) => `<div class="order-line"><span>${escapeHTML(item.by)} · ${escapeHTML(item.name)} × ${item.quantity}</span><strong>${won(item.price * item.quantity)}</strong></div>`).join("")}<button class="secondary-button" style="width:100%;margin-top:17px" data-page="payment">입금 현황 열기</button></aside></div>${receiptCount === people.length && people.length ? `<section class="page-card" style="margin-top:15px;text-align:center"><h2 style="font-size:16px">모든 참여자가 수령을 확인했어요!</h2><p class="subheading">함께한 이웃과 즐거운 식사였나요?</p><button class="primary-button" data-action="review">서로 평가하기 →</button></section>` : ""}`;
}

function groupPageEmptyState(title, message) {
  return `<div class="page-heading"><div><div class="eyebrow">GROUP ORDER</div><h1>${escapeHTML(title)}</h1></div></div><section class="page-card"><div class="empty-state">${escapeHTML(message)}<br /><button class="primary-button" style="margin-top:16px" data-page="discover">모집글 찾기</button></div></section>`;
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

async function closeRecruitmentPost(postId = selectedPost?.id) {
  await authInitialization;
  if (!authState.client || !authState.user || !postId) {
    showToast("모집글을 조기 마감하려면 로그인하고 다시 시도해 주세요.");
    return;
  }
  const post = posts.find((item) => String(item.id) === String(postId));
  if (!post || !isPostOwner(post)) {
    showToast("내가 작성한 모집글만 조기 마감할 수 있어요.");
    return;
  }
  if (Date.parse(post.deadlineAt || "") <= Date.now()) {
    showToast("이미 마감된 모집글이에요.");
    return;
  }
  if (!window.confirm("모집을 지금 마감할까요? 이후에는 새 신청을 받거나 대기 중인 신청을 승인할 수 없지만, 이미 승인된 참가자와는 계속 진행할 수 있어요.")) return;

  const { error } = await authState.client.rpc("close_recruitment_post", {
    p_post_id: post.id
  });
  if (error) {
    showToast(`모집글을 조기 마감하지 못했습니다: ${error.message}`);
    return;
  }

  try {
    await refreshRecruitmentData();
    showToast("모집을 조기 마감했어요. 승인된 참가자와의 공동 주문은 계속 이용할 수 있어요.");
  } catch (error) {
    showToast(`모집은 마감했지만 화면을 새로고침하지 못했습니다: ${error.message}`);
  }
}

async function saveParticipantMenu(form) {
  await authInitialization;
  if (!authState.client || !authState.user || !selectedPost) {
    showToast("메뉴를 저장하려면 로그인하고 모집글을 다시 열어 주세요.");
    return;
  }
  const application = applications.find((item) =>
    item.post_id === selectedPost.id
    && item.applicant_id === authState.user.id
    && item.status === "approved");
  if (!application) {
    showToast("메뉴 선택은 신청이 승인된 참가자만 할 수 있어요.");
    return;
  }
  const inputs = [...form.querySelectorAll("[data-menu-id]")];
  if (inputs.some((input) => !Number.isInteger(Number(input.value)) || Number(input.value) < 0 || Number(input.value) > 10)) {
    showToast("메뉴 수량은 0개부터 10개까지 선택해 주세요.");
    return;
  }
  const selectedMenu = inputs
    .filter((input) => Number(input.value) > 0)
    .map((input) => ({ id: input.dataset.menuId, quantity: Number(input.value) }));
  const { error } = await authState.client.rpc("save_recruitment_menu_selection", {
    p_application_id: application.id,
    p_selected_menu: selectedMenu
  });
  if (error) {
    showToast(`메뉴를 저장하지 못했습니다: ${error.message}`);
    return;
  }
  try {
    await refreshRecruitmentData();
    showToast(`메뉴를 저장했어요. 현재 주문금액은 ${won(selectedPost?.amount || 0)}이에요.`);
  } catch (error) {
    showToast(`저장한 메뉴 정보를 새로고침하지 못했습니다: ${error.message}`);
  }
}

async function deleteRecruitmentPost(postId = selectedPost?.id) {
  await authInitialization;
  if (!authState.client || !authState.user || !postId) {
    showToast("모집글을 삭제하려면 로그인하고 다시 시도해 주세요.");
    return;
  }
  const post = posts.find((item) => String(item.id) === String(postId));
  if (!post || !isPostOwner(post)) {
    showToast("내가 작성한 모집글만 삭제할 수 있어요.");
    return;
  }
  if (post.paymentsStartedAt) {
    showToast("입금이 시작된 모집글은 삭제할 수 없어요.");
    return;
  }
  if (!window.confirm(`'${post.restaurant}' 모집글을 삭제할까요? 신청 내역도 함께 삭제되며 되돌릴 수 없습니다.`)) return;

  const { data, error } = await authState.client.rpc("delete_recruitment_post", {
    p_post_id: post.id
  });
  if (error) {
    showToast(`모집글을 삭제하지 못했습니다: ${error.message}`);
    return;
  }
  if (!data) {
    showToast("모집글을 삭제하지 못했어요. 작성자 권한을 확인해 주세요.");
    return;
  }

  selectedPost = null;
  setPage("discover");
  try {
    await refreshRecruitmentData();
    showToast("모집글과 해당 신청 내역을 삭제했어요.");
  } catch (error) {
    showToast(`삭제했지만 목록을 새로고침하지 못했습니다: ${error.message}`);
  }
}

async function submitGroupMessage(form) {
  const post = getActiveGroupPost();
  if (!authState.client || !authState.user || !post) {
    showToast("채팅 메시지를 보내려면 로그인하고 모집글 참여 승인을 받아야 해요.");
    return;
  }
  const body = String(new FormData(form).get("message") || "").trim();
  if (!body) {
    showToast("메시지를 입력해 주세요.");
    return;
  }
  const { error } = await authState.client.from("recruitment_messages").insert({
    post_id: post.id,
    sender_id: authState.user.id,
    sender_name: currentUserName(),
    body
  });
  if (error) {
    showToast(`메시지를 보내지 못했습니다: ${error.message}`);
    return;
  }
  form.reset();
  try {
    await loadGroupData(post);
    render();
  } catch (error) {
    showToast(`메시지는 보냈지만 새로고침하지 못했습니다: ${error.message}`);
  }
}

async function confirmGroupReceipt() {
  const post = getActiveGroupPost();
  const person = groupParticipants(post).find((participant) => participant.id === authState.user?.id);
  if (!authState.client || !authState.user || !post || !person) {
    showToast("모집글 참여자만 수령 확인을 할 수 있어요.");
    return;
  }
  if (paymentGroup?.status !== "ORDER_READY") {
    showToast("모든 참가자의 입금이 확인된 뒤 실제 음식을 받으면 수령을 확인해 주세요.");
    return;
  }
  const { error } = await authState.client.from("recruitment_receipts").insert({
    post_id: post.id,
    user_id: authState.user.id,
    participant_name: currentUserName()
  });
  if (error) {
    showToast(`수령 확인을 저장하지 못했습니다: ${error.message}`);
    return;
  }
  try {
    await loadGroupData(post);
    render();
    showToast("음식 수령을 확인했어요.");
  } catch (error) {
    showToast(`수령 확인은 저장했지만 새로고침하지 못했습니다: ${error.message}`);
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
    case "delete-post":
      void deleteRecruitmentPost(target.dataset.postId).catch((error) => {
        console.error("Recruitment post deletion error:", error.message);
        showToast(`모집글을 삭제하지 못했습니다: ${error.message}`);
      });
      break;
    case "refresh": showToast("현재 위치 주변의 모집글을 보여드리고 있어요."); break;
    case "apply":
      if (isPostOwner(selectedPost)) {
        showToast("내가 만든 모집글에는 동참 신청할 수 없어요.");
        break;
      }
      if (selectedPost.deadlineAt && Date.parse(selectedPost.deadlineAt) <= Date.now()) {
        showToast("모집 마감 시간이 지났어요.");
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
    case "close-post":
      void closeRecruitmentPost(target.dataset.postId).catch((error) => {
        console.error("Recruitment early-close error:", error.message);
        showToast(`모집글을 조기 마감하지 못했습니다: ${error.message}`);
      });
      break;
    case "open-own-menu": setPage("detail"); break;
    case "participant-account":
      void showParticipantAccount(target.dataset.participant).catch((error) => {
        console.error("Virtual account request error:", error.message);
        showToast(`가상계좌를 처리하지 못했습니다: ${error.message}`);
      });
      break;
    case "copy-issued-account":
      navigator.clipboard?.writeText(target.dataset.account)
        .then(() => showToast("가상계좌 번호를 복사했어요."))
        .catch(() => showToast(`계좌번호: ${target.dataset.account}`));
      break;
    case "received":
      void confirmGroupReceipt().catch((error) => showToast(`수령 확인을 처리하지 못했습니다: ${error.message}`));
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
  if (event.target.id === "deadline") {
    const customDeadline = document.querySelector("#customDeadline");
    customDeadline.hidden = event.target.value !== "custom";
    customDeadline.required = event.target.value === "custom";
    if (customDeadline.required && !customDeadline.value) {
      const date = new Date(Date.now() + 60 * 60_000);
      customDeadline.value = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    }
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("#menuSelection [data-menu-id]")) {
    updateCreateOrderSummary(event.target.form);
  }
  if (event.target.matches("#participantMenuForm [data-menu-id]")) {
    updateParticipantMenuTotal(event.target.form);
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "authForm") {
    await submitAuthForm(event);
    return;
  }
  if (event.target.id === "participantMenuForm") {
    event.preventDefault();
    await saveParticipantMenu(event.target);
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
    const deadlineValue = String(form.get("deadline") || "");
    const deadlineDate = deadlineValue === "custom"
      ? new Date(String(form.get("customDeadline") || ""))
      : new Date(Date.now() + Number(deadlineValue) * 60_000);
    if (!Number.isFinite(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) {
      showToast("모집 마감 시간은 현재 시각보다 뒤로 선택해 주세요.");
      return;
    }
    const deadlineAt = deadlineDate.toISOString();
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
      deadline: `${deadlineValue === "custom" ? new Date(deadlineAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : `${deadlineValue}분 후`} 마감`,
      deadline_at: deadlineAt,
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
    await submitGroupMessage(event.target);
  }
});

document.querySelector("#modalClose").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (event) => { if (event.target === modalBackdrop) closeModal(); });
document.addEventListener("click", (event) => {
  if (event.target.id === "modalDone") closeModal();
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
const initialPage = new URLSearchParams(window.location.search).get("page");
const initialPostId = new URLSearchParams(window.location.search).get("postId");
render();
window.setInterval(updateDeadlineCountdowns, 1000);
authInitialization = initializeAuth().then(() => {
  if (initialPage === "payment" && authState.user) {
    if (initialPostId) selectedPost = posts.find((post) => String(post.id) === initialPostId) || null;
    setPage("payment");
    showToast("가상계좌 상태를 불러왔어요.");
  }
});
