# 모아먹자 정적 프로토타입

## Vercel 배포

GitHub 저장소를 Vercel에 가져오고 Framework Preset은 `Other`, Root Directory는 저장소 루트로 둡니다. 별도 빌드 명령 없이 배포할 수 있습니다. `api/`의 서버리스 함수는 Vercel이 자동으로 배포합니다.

## Toss 가상계좌 테스트 준비

가상계좌는 모집글별로 승인된 참여자에게 각각 발급합니다. 모집글 작성자는 본인이 고른 메뉴 금액을, 참여자는 본인이 고른 메뉴 금액을 부담합니다. 실제 결제 연동은 Toss 테스트 키로만 검증할 수 있습니다.

1. Toss Payments 개발자센터에서 테스트 상점의 **클라이언트 키**와 **시크릿 키**를 발급합니다. `test_ck_` 및 `test_sk_`로 시작하는 테스트 키만 이 API에서 허용합니다.
2. Upstash에서 Redis 데이터베이스를 만들고 REST URL과 REST Token을 준비합니다. 서버리스 재시작 뒤에도 발급 내역과 입금 상태를 보존하기 위해 필요합니다.
3. Vercel 프로젝트의 **Settings → Environment Variables**에 다음 값을 설정하고 새 배포를 합니다.
   - `TOSS_SECRET_KEY`
   - `TOSS_CLIENT_KEY`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `PUBLIC_APP_URL` (예: `https://your-project.vercel.app`)
   - `QSTASH_URL` (QStash 대시보드 Quickstart의 `QSTASH_URL`, 예: `https://qstash-eu-central-1.upstash.io`)
   - `QSTASH_TOKEN`
   - `CRON_SECRET` (충분히 긴 임의의 비밀 문자열)
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (publishable/anon 공개 키만 사용하고 service_role 키는 사용하지 마세요)
4. Toss Payments 개발자센터의 **웹훅** 메뉴에서 이벤트 `가상계좌 입금 통보(DEPOSIT_CALLBACK)`를 등록합니다. URL은 `https://<배포 도메인>/api/toss-webhook`입니다.
5. 사이트의 입금 현황에서 참여자별 `가상계좌 발급`을 눌러 토스 결제창을 엽니다. 결제창에서 가상계좌와 은행을 선택하면 서버가 결제를 승인하고 해당 참여자의 분담액 가상계좌를 발급합니다.
6. 개발자센터의 테스트 결제 내역에서 해당 테스트 가상계좌를 입금 처리합니다. 웹훅의 secret과 토스 결제 상태·금액을 서버가 검증해 입금 상태를 갱신하며, 웹훅이 늦거나 누락되면 입금 현황을 새로고침할 때 Toss 결제 상태도 조회해 보완합니다. 입금 후에도 대기 상태라면 개발자센터에서 앱에 표시된 참여자·금액·주문번호와 같은 결제인지 확인하고, 입금 현황 화면을 다시 열어 주세요.
7. Upstash QStash Quickstart에서 `QSTASH_URL`과 Token을 확인해 각각 `QSTASH_URL`, `QSTASH_TOKEN`에 넣고, `CRON_SECRET`에는 충분히 긴 임의의 비밀 문자열을 설정합니다. QStash URL은 선택한 리전에 맞는 값을 사용합니다. 첫 참여자가 가상계좌 발급을 시작한 시점부터 5분이 공동 입금 마감입니다. 전원이 입금하면 주문 준비 상태가 되고, 한 명이라도 미입금이면 `/api/expire-group`이 미입금 계좌를 취소하고 입금된 결제는 환불을 요청합니다. 환불 계좌 정보가 없는 결제는 자동 취소하지 않고 확인 필요 상태로 남깁니다.

입금 제한 시간은 배포 후 새로 시작하는 결제 그룹부터 적용됩니다. 이미 시작된 결제 그룹의 마감 시각은 변경하지 않습니다.

### 이메일 로그인 설정

Supabase 프로젝트를 만들고 **Project Settings → API**에서 Project URL과 publishable/anon 키를 확인해 Vercel 환경 변수 `SUPABASE_URL`, `SUPABASE_ANON_KEY`에 등록합니다. service_role 키는 절대 브라우저나 환경 변수 응답에 사용하지 마세요. Supabase의 **Authentication → Providers → Email**에서 이메일 로그인을 켜고, **Authentication → URL Configuration**의 Site URL에 배포 도메인을 입력합니다. Redirect URLs에도 이메일 인증과 비밀번호 재설정에 사용할 배포 주소를 추가합니다. Vercel 환경 변수 등록 후 재배포하면 로그인, 회원가입, 이메일 인증, 로그아웃, 비밀번호 재설정 화면이 활성화됩니다.

모집글을 여러 사용자에게 공유하려면 Supabase **SQL Editor**에서 앞서 안내한 `recruitment_posts` 스키마를 실행하고, 저장소의 [`supabase/applications.sql`](./supabase/applications.sql) 내용을 추가로 실행하세요. 공개 모집글은 로그인 전에도 조회할 수 있고, 등록과 신청은 로그인 사용자만 가능하며, 승인/거절은 모집글 소유자만 가능합니다.

```sql
create table if not exists public.recruitment_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id text not null default '',
  restaurant text not null,
  emoji text not null,
  theme text not null default 'chicken',
  category text not null,
  distance_meters integer not null default 90,
  joined integer not null default 1,
  max_participants integer not null,
  minimum_amount integer not null,
  current_amount integer not null default 0,
  selected_menu jsonb not null default '[]'::jsonb,
  deadline text not null,
  deadline_at timestamptz not null default (now() + interval '15 minutes'),
  leader text not null,
  rating numeric not null default 4.8,
  trades integer not null default 0,
  note text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.recruitment_posts enable row level security;

drop policy if exists "Anyone can view open recruitment posts" on public.recruitment_posts;
create policy "Anyone can view open recruitment posts"
  on public.recruitment_posts for select
  using (status = 'open');

drop policy if exists "Signed-in users can create their own recruitment posts" on public.recruitment_posts;
create policy "Signed-in users can create their own recruitment posts"
  on public.recruitment_posts for insert to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "Owners can update their own recruitment posts" on public.recruitment_posts;
create policy "Owners can update their own recruitment posts"
  on public.recruitment_posts for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Owners can delete their own recruitment posts" on public.recruitment_posts;
create policy "Owners can delete their own recruitment posts"
  on public.recruitment_posts for delete to authenticated
  using (auth.uid() = owner_id);

grant select on public.recruitment_posts to anon, authenticated;
grant insert, update, delete on public.recruitment_posts to authenticated;
```

기존 DB에는 아직 실행하지 않은 SQL을 아래 순서대로 적용하세요. `recruitment-menu-columns.sql`을 이미 적용했다면 건너뛰면 됩니다. 앞의 네 마이그레이션을 이미 적용한 기존 설치는 조기 마감 기능을 위해 5번만 추가 실행하면 됩니다.

1. [`supabase/applications.sql`](./supabase/applications.sql)
2. [`supabase/recruitment-menu-columns.sql`](./supabase/recruitment-menu-columns.sql) (이미 실행한 경우 생략)
3. [`supabase/recruitment-menu-selections.sql`](./supabase/recruitment-menu-selections.sql)
4. [`supabase/recruitment-group-workflows.sql`](./supabase/recruitment-group-workflows.sql)
5. [`supabase/recruitment-early-close.sql`](./supabase/recruitment-early-close.sql)

마지막 두 마이그레이션은 모집 마감 시각과 남은 시간, 승인된 참여자 전용 채팅/수령 확인, 결제 시작 잠금 및 그룹별 결제 roster를 설정하고 리더의 조기 마감을 지원합니다. 기존 모집글의 마감 시각은 저장된 생성 시각과 기존 마감 문구를 바탕으로 채웁니다. 리더는 상세 화면이나 신청자 관리에서 모집을 조기 마감할 수 있으며, 이후 새 신청과 대기 중인 신청 승인은 차단되고 이미 승인된 구성원은 계속 공동 주문을 이용할 수 있습니다. 모집글 작성자는 본인 모집글을 삭제할 수 있으며, 연결된 신청 내역도 함께 삭제됩니다. 앱의 음식점·메뉴·최소주문금액은 현재 테스트용 목록으로 제공되며, 실제 배달 플랫폼이나 음식점 메뉴 API와 연동된 것은 아닙니다.

모집글 작성에서 음식점을 선택하면 테스트 목록의 메뉴와 수량을 고를 수 있고, 메뉴 가격으로 주문 합계를 계산합니다. 신청자가 모집글에서 동참 신청을 누르면 Supabase에 저장되며, 모집글 소유자는 신청을 승인하거나 거절할 수 있습니다. 승인된 참가자는 모집글 상세에서 본인 메뉴를 저장하고, 자신의 메뉴 금액대로 Toss 테스트 가상계좌를 발급할 수 있습니다. 채팅 메시지, 참가자별 메뉴, Toss 입금 상태, 실제 수령 확인은 모집글별로 연결됩니다. 결제 시작 뒤에는 메뉴 변경이 잠기며, 첫 가상계좌 발급 후 5분 내 전원 미입금 시 미입금 계좌 취소와 입금 완료분 환불을 요청하는 흐름은 QStash/Toss 테스트 연동을 사용합니다. 주문/배달 상태는 실제 배달 플랫폼 API가 없어 자동 표시하지 않습니다. 진행 상황은 확인 가능한 모집·메뉴·입금 및 참가자 수령 확인만 표시합니다.

### 가상계좌 환불 필수 설정

토스페이먼츠 결제 어드민의 **기능 → 가상계좌 → 가상계좌 환불 정보 입력 → 사용함**을 켜세요. 결제자가 결제창에서 본인 환불 계좌를 제출해야 입금 완료 결제의 취소 API에 환불 계좌를 전달할 수 있습니다. 승인 응답에서 받은 환불 계좌 정보는 서버의 Upstash Redis에만 보관하고, 공개 입금 현황 API에서는 반환하지 않습니다. 해당 정보가 없으면 결제를 임의 취소하지 않고 `환불 확인 필요` 상태로 남겨 자동 환불이 불가능한 경우를 알립니다.

가상계좌 결제 취소는 즉시 은행 이체가 아니라 보통 취소일로부터 영업일 기준 2일이 걸립니다. 앱은 토스 취소 요청 완료를 `환불 처리 중`으로 표시합니다. QStash 지연 예약을 쓰므로 Vercel Cron의 빈도 제한에 의존하지 않습니다.

환경 변수 이름은 `.env.example`에 있으며 실제 키나 토큰을 GitHub에 올리지 마세요. 브라우저에는 Toss 시크릿 키를 전달하지 않습니다.

## 범위 및 실서비스 전환 전 필수 작업

이메일 인증과 모집글 공유, 신청 승인/거절, 승인된 구성원의 채팅, 메뉴별 부담액 계산, 테스트 가상계좌 발급 및 테스트 취소/환불 흐름은 Supabase, Toss, Upstash, QStash를 사용합니다. 주문·배달 업체 API가 연결되어 있지 않으므로 실제 주문 접수나 배달 중 상태는 표시하지 않습니다. 테스트 키를 실서비스 키로 바꾸는 것만으로 실서비스 전환이 되지 않으며, Toss 계약·심사, 운영 및 분쟁 처리 등 추가 작업이 필요합니다.
