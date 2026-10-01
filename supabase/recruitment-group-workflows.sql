alter table public.recruitment_posts
  add column if not exists deadline_at timestamptz,
  add column if not exists payments_started_at timestamptz;

update public.recruitment_posts
set deadline_at = created_at + case
  when deadline ~ '[0-9]+[[:space:]]*시간' then
    coalesce(nullif(substring(deadline from '[0-9]+'), '')::integer, 1) * interval '1 hour'
  when deadline ~ '[0-9]+[[:space:]]*분' then
    coalesce(nullif(substring(deadline from '[0-9]+'), '')::integer, 15) * interval '1 minute'
  else interval '15 minutes'
end
where deadline_at is null;

alter table public.recruitment_posts
  alter column deadline_at set default (now() + interval '15 minutes'),
  alter column deadline_at set not null;

drop policy if exists "Users can apply to open posts they do not own" on public.recruitment_applications;
create policy "Users can apply to open posts they do not own"
  on public.recruitment_applications for insert to authenticated
  with check (
    applicant_id = (select auth.uid())
    and applicant_name = coalesce(
      nullif(auth.jwt() -> 'user_metadata' ->> 'display_name', ''),
      split_part(auth.jwt() ->> 'email', '@', 1)
    )
    and exists (
      select 1
      from public.recruitment_posts
      where recruitment_posts.id = recruitment_applications.post_id
        and recruitment_posts.owner_id <> (select auth.uid())
        and recruitment_posts.status = 'open'
        and recruitment_posts.deadline_at > now()
        and recruitment_posts.joined < recruitment_posts.max_participants
    )
  );

create or replace function public.is_recruitment_member(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.recruitment_posts p
    where p.id = p_post_id
      and (
        p.owner_id = (select auth.uid())
        or exists (
          select 1 from public.recruitment_applications a
          where a.post_id = p.id
            and a.applicant_id = (select auth.uid())
            and a.status = 'approved'
        )
      )
  );
$$;

revoke all on function public.is_recruitment_member(uuid) from public, anon;
grant execute on function public.is_recruitment_member(uuid) to authenticated;

drop policy if exists "Post participants can view approved application roster" on public.recruitment_applications;
create policy "Post participants can view approved application roster"
  on public.recruitment_applications for select to authenticated
  using (status = 'approved' and public.is_recruitment_member(post_id));

create table if not exists public.recruitment_messages (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.recruitment_posts(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_name text not null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table public.recruitment_messages enable row level security;

drop policy if exists "Recruitment members can read group messages" on public.recruitment_messages;
create policy "Recruitment members can read group messages"
  on public.recruitment_messages for select to authenticated
  using (
    exists (
      select 1 from public.recruitment_posts p
      where p.id = recruitment_messages.post_id
        and (
          p.owner_id = (select auth.uid())
          or exists (
            select 1 from public.recruitment_applications a
            where a.post_id = p.id
              and a.applicant_id = (select auth.uid())
              and a.status = 'approved'
          )
        )
    )
  );

drop policy if exists "Approved recruitment members can send group messages" on public.recruitment_messages;
create policy "Approved recruitment members can send group messages"
  on public.recruitment_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_name = coalesce(
      nullif(auth.jwt() -> 'user_metadata' ->> 'display_name', ''),
      split_part(auth.jwt() ->> 'email', '@', 1)
    )
    and exists (
      select 1 from public.recruitment_posts p
      where p.id = recruitment_messages.post_id
        and (
          p.owner_id = (select auth.uid())
          or exists (
            select 1 from public.recruitment_applications a
            where a.post_id = p.id
              and a.applicant_id = (select auth.uid())
              and a.status = 'approved'
          )
        )
    )
  );

grant select, insert on public.recruitment_messages to authenticated;

create table if not exists public.recruitment_receipts (
  post_id uuid not null references public.recruitment_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_name text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.recruitment_receipts enable row level security;

drop policy if exists "Recruitment members can view receipt confirmations" on public.recruitment_receipts;
create policy "Recruitment members can view receipt confirmations"
  on public.recruitment_receipts for select to authenticated
  using (
    exists (
      select 1 from public.recruitment_posts p
      where p.id = recruitment_receipts.post_id
        and p.payments_started_at is not null
        and (
          p.owner_id = (select auth.uid())
          or exists (
            select 1 from public.recruitment_applications a
            where a.post_id = p.id
              and a.applicant_id = (select auth.uid())
              and a.status = 'approved'
          )
        )
    )
  );

drop policy if exists "Recruitment members can confirm their own receipt" on public.recruitment_receipts;
create policy "Recruitment members can confirm their own receipt"
  on public.recruitment_receipts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and participant_name = coalesce(
      nullif(auth.jwt() -> 'user_metadata' ->> 'display_name', ''),
      split_part(auth.jwt() ->> 'email', '@', 1)
    )
    and exists (
      select 1 from public.recruitment_posts p
      where p.id = recruitment_receipts.post_id
        and p.payments_started_at is not null
        and (
          p.owner_id = (select auth.uid())
          or exists (
            select 1 from public.recruitment_applications a
            where a.post_id = p.id
              and a.applicant_id = (select auth.uid())
              and a.status = 'approved'
          )
        )
    )
  );

grant select, insert on public.recruitment_receipts to authenticated;

drop policy if exists "Owners can delete their own recruitment posts" on public.recruitment_posts;
revoke update, delete on public.recruitment_posts from authenticated;

create or replace function public.normalize_recruitment_post_menu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_menu jsonb;
  menu_total integer;
begin
  if jsonb_typeof(new.selected_menu) is distinct from 'array' then
    raise exception 'A recruitment post must contain a menu array';
  end if;
  if jsonb_array_length(new.selected_menu) = 0 or jsonb_array_length(new.selected_menu) > 4 then
    raise exception 'A recruitment post must contain one to four menu items';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(new.selected_menu) as item(id text, quantity integer)
    left join public.restaurant_menu_catalog catalog
      on catalog.restaurant_id = new.restaurant_id
      and catalog.menu_id = item.id
    where catalog.menu_id is null
      or item.quantity is null
      or item.quantity < 1
      or item.quantity > 10
  ) then
    raise exception 'The selected menu contains an invalid item or quantity';
  end if;

  if exists (
    select item.id
    from jsonb_to_recordset(new.selected_menu) as item(id text, quantity integer)
    group by item.id
    having count(*) > 1
  ) then
    raise exception 'A menu item can only be selected once';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', catalog.menu_id,
    'name', catalog.name,
    'price', catalog.price,
    'quantity', item.quantity
  ) order by catalog.menu_id),
  sum(catalog.price * item.quantity)::integer
  into normalized_menu, menu_total
  from jsonb_to_recordset(new.selected_menu) as item(id text, quantity integer)
  join public.restaurant_menu_catalog catalog
    on catalog.restaurant_id = new.restaurant_id
    and catalog.menu_id = item.id;

  new.selected_menu := normalized_menu;
  new.current_amount := menu_total;
  return new;
end;
$$;

drop trigger if exists normalize_recruitment_post_menu on public.recruitment_posts;
create trigger normalize_recruitment_post_menu
  before insert or update of restaurant_id, selected_menu on public.recruitment_posts
  for each row execute function public.normalize_recruitment_post_menu();

revoke all on function public.normalize_recruitment_post_menu() from public, anon, authenticated;

create or replace function public.get_recruitment_payment_roster(p_post_id uuid)
returns table (participant_id uuid, participant_name text, amount integer, role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_row public.recruitment_posts;
begin
  select * into post_row
  from public.recruitment_posts p
  where p.id = p_post_id
    and (
      p.owner_id = (select auth.uid())
      or exists (
        select 1 from public.recruitment_applications a
        where a.post_id = p.id
          and a.applicant_id = (select auth.uid())
          and a.status = 'approved'
      )
    );

  if not found then
    raise exception 'Only recruitment members can view payment participants';
  end if;

  return query
  select post_row.owner_id, post_row.leader,
    coalesce(sum(catalog.price * item.quantity), 0)::integer, 'leader'::text
  from jsonb_to_recordset(post_row.selected_menu) as item(id text, quantity integer)
  left join public.restaurant_menu_catalog catalog
    on catalog.restaurant_id = post_row.restaurant_id
    and catalog.menu_id = item.id
  group by post_row.owner_id, post_row.leader;

  return query
  select a.applicant_id, a.applicant_name, coalesce(s.amount, 0), 'participant'::text
  from public.recruitment_applications a
  left join public.recruitment_menu_selections s on s.application_id = a.id
  where a.post_id = post_row.id
    and a.status = 'approved';
end;
$$;

revoke all on function public.get_recruitment_payment_roster(uuid) from public, anon;
grant execute on function public.get_recruitment_payment_roster(uuid) to authenticated;

create or replace function public.begin_recruitment_payments(p_post_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_row public.recruitment_posts;
  started_at timestamptz;
begin
  if not public.is_recruitment_member(p_post_id) then
    raise exception 'Only recruitment members can start payment';
  end if;

  perform 1 from public.recruitment_posts
  where id = p_post_id
  for update;

  select * into post_row
  from public.recruitment_posts
  where id = p_post_id;

  if exists (
    select 1
    from public.get_recruitment_payment_roster(p_post_id) roster
    where roster.amount <= 0
  ) then
    raise exception 'Every participant must choose a menu before payment starts';
  end if;

  update public.recruitment_posts
  set payments_started_at = coalesce(payments_started_at, now())
  where id = p_post_id
  returning payments_started_at into started_at;

  return started_at;
end;
$$;

revoke all on function public.begin_recruitment_payments(uuid) from public, anon;
grant execute on function public.begin_recruitment_payments(uuid) to authenticated;

create or replace function public.prevent_post_menu_changes_after_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.payments_started_at is not null and new.selected_menu is distinct from old.selected_menu then
    raise exception 'Menu selections cannot change after payment starts';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_post_menu_changes_after_payment on public.recruitment_posts;
create trigger prevent_post_menu_changes_after_payment
  before update of selected_menu on public.recruitment_posts
  for each row execute function public.prevent_post_menu_changes_after_payment();

revoke all on function public.prevent_post_menu_changes_after_payment() from public, anon, authenticated;

create or replace function public.delete_recruitment_post(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_row public.recruitment_posts;
begin
  select * into post_row
  from public.recruitment_posts
  where id = p_post_id
  for update;

  if not found or post_row.owner_id <> (select auth.uid()) then
    raise exception 'Only the post owner can delete this recruitment post';
  end if;
  if post_row.payments_started_at is not null then
    raise exception 'Recruitment posts cannot be deleted after payment starts';
  end if;

  delete from public.recruitment_posts
  where id = post_row.id;

  return true;
end;
$$;

revoke all on function public.delete_recruitment_post(uuid) from public, anon;
grant execute on function public.delete_recruitment_post(uuid) to authenticated;

create or replace function public.prevent_menu_changes_after_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1 from public.recruitment_posts
      where id = old.post_id and payments_started_at is not null
    ) then
      raise exception 'Menu selections cannot change after payment starts';
    end if;
    return old;
  end if;

  if exists (
    select 1 from public.recruitment_posts
    where id = new.post_id and payments_started_at is not null
  ) then
    raise exception 'Menu selections cannot change after payment starts';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_menu_changes_after_payment on public.recruitment_menu_selections;
create trigger prevent_menu_changes_after_payment
  before insert or update or delete on public.recruitment_menu_selections
  for each row execute function public.prevent_menu_changes_after_payment();

revoke all on function public.prevent_menu_changes_after_payment() from public, anon, authenticated;

create or replace function public.review_recruitment_application(application_id uuid, decision text)
returns public.recruitment_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  application_row public.recruitment_applications;
  post_row public.recruitment_posts;
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Invalid application decision';
  end if;

  select * into application_row
  from public.recruitment_applications
  where id = application_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Pending application not found';
  end if;

  select * into post_row
  from public.recruitment_posts
  where id = application_row.post_id
  for update;

  if not found or post_row.owner_id <> (select auth.uid()) then
    raise exception 'Only the post owner can review applications';
  end if;

  if decision = 'approved' then
    if post_row.status <> 'open' or post_row.deadline_at <= now() or post_row.joined >= post_row.max_participants then
      raise exception 'Recruitment post is full, expired, or closed';
    end if;
    update public.recruitment_posts
    set joined = joined + 1
    where id = post_row.id;
  end if;

  update public.recruitment_applications
  set status = decision
  where id = application_row.id
  returning * into application_row;

  return application_row;
end;
$$;

revoke all on function public.review_recruitment_application(uuid, text) from public, anon;
grant execute on function public.review_recruitment_application(uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recruitment_posts'
  ) then
    execute 'alter publication supabase_realtime add table public.recruitment_posts';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recruitment_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.recruitment_messages';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recruitment_menu_selections'
  ) then
    execute 'alter publication supabase_realtime add table public.recruitment_menu_selections';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recruitment_receipts'
  ) then
    execute 'alter publication supabase_realtime add table public.recruitment_receipts';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recruitment_applications'
  ) then
    execute 'alter publication supabase_realtime add table public.recruitment_applications';
  end if;
end;
$$;
