create table if not exists public.restaurant_menu_catalog (
  restaurant_id text not null,
  menu_id text not null,
  name text not null,
  price integer not null check (price > 0),
  primary key (restaurant_id, menu_id)
);

revoke all on public.restaurant_menu_catalog from public, anon, authenticated;

insert into public.restaurant_menu_catalog (restaurant_id, menu_id, name, price)
values
  ('yeonnam-chicken', 'original-chicken', '후라이드 치킨', 18000),
  ('yeonnam-chicken', 'seasoned-chicken', '양념 치킨', 20000),
  ('yeonnam-chicken', 'cheese-balls', '치즈볼', 5000),
  ('yeonnam-chicken', 'cola', '콜라', 2000),
  ('yeonnam-pizza', 'cheese-pizza', '치즈 피자', 22000),
  ('yeonnam-pizza', 'pepperoni-pizza', '페퍼로니 피자', 25000),
  ('yeonnam-pizza', 'garlic-bread', '갈릭 브레드', 5000),
  ('yeonnam-pizza', 'soda', '탄산음료', 2000),
  ('hongdae-tteokbokki', 'tteokbokki', '떡볶이', 12000),
  ('hongdae-tteokbokki', 'fried-snacks', '모둠 튀김', 7000),
  ('hongdae-tteokbokki', 'rice-roll', '참치 김밥', 5000),
  ('hongdae-tteokbokki', 'fish-cake', '어묵탕', 6000)
on conflict (restaurant_id, menu_id) do update
set name = excluded.name, price = excluded.price;

create table if not exists public.recruitment_menu_selections (
  application_id uuid primary key references public.recruitment_applications(id) on delete cascade,
  post_id uuid not null references public.recruitment_posts(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  applicant_name text not null,
  selected_menu jsonb not null default '[]'::jsonb check (jsonb_typeof(selected_menu) = 'array'),
  amount integer not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now()
);

alter table public.recruitment_menu_selections enable row level security;

drop policy if exists "Owners and approved participants can view menu selections" on public.recruitment_menu_selections;
create policy "Owners and approved participants can view menu selections"
  on public.recruitment_menu_selections for select to authenticated
  using (
    exists (
      select 1
      from public.recruitment_posts p
      where p.id = recruitment_menu_selections.post_id
        and p.owner_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.recruitment_applications a
      where a.post_id = recruitment_menu_selections.post_id
        and a.applicant_id = (select auth.uid())
        and a.status = 'approved'
    )
  );

revoke all on public.recruitment_menu_selections from public, anon, authenticated;
grant select on public.recruitment_menu_selections to authenticated;

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

  delete from public.recruitment_posts
  where id = post_row.id;

  return true;
end;
$$;

revoke all on function public.delete_recruitment_post(uuid) from public, anon;
grant execute on function public.delete_recruitment_post(uuid) to authenticated;

create or replace function public.save_recruitment_menu_selection(
  p_application_id uuid,
  p_selected_menu jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  application_row public.recruitment_applications;
  post_row public.recruitment_posts;
  normalized_menu jsonb;
  selected_amount integer;
  existing_participant_amount bigint;
  total_participant_amount bigint;
  base_amount bigint;
begin
  if jsonb_typeof(p_selected_menu) is distinct from 'array' then
    raise exception 'Menu selection must be an array';
  end if;

  if jsonb_array_length(p_selected_menu) > 4 then
    raise exception 'Too many menu items selected';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_selected_menu) as entry(value)
    where jsonb_typeof(entry.value) <> 'object'
      or nullif(entry.value ->> 'id', '') is null
      or nullif(entry.value ->> 'quantity', '') is null
  ) then
    raise exception 'Each menu selection must include an item and quantity';
  end if;

  select * into application_row
  from public.recruitment_applications
  where id = p_application_id
  for update;

  if not found
    or application_row.applicant_id <> (select auth.uid())
    or application_row.status <> 'approved' then
    raise exception 'Only approved participants can save menu selections';
  end if;

  select * into post_row
  from public.recruitment_posts
  where id = application_row.post_id
  for update;

  if not found or post_row.status <> 'open' then
    raise exception 'Recruitment post is closed or unavailable';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_selected_menu) as item(id text, quantity integer)
    left join public.restaurant_menu_catalog catalog
      on catalog.restaurant_id = post_row.restaurant_id
      and catalog.menu_id = item.id
    where catalog.menu_id is null
      or item.quantity is null
      or item.quantity < 1
      or item.quantity > 10
  ) then
    raise exception 'Menu item or quantity is not valid for this restaurant';
  end if;

  if exists (
    select item.id
    from jsonb_to_recordset(p_selected_menu) as item(id text, quantity integer)
    group by item.id
    having count(*) > 1
  ) then
    raise exception 'A menu item can only be selected once';
  end if;

  select
    coalesce(
      jsonb_agg(jsonb_build_object(
        'id', catalog.menu_id,
        'name', catalog.name,
        'price', catalog.price,
        'quantity', item.quantity
      ) order by catalog.menu_id),
      '[]'::jsonb
    ),
    coalesce(sum(catalog.price * item.quantity), 0)::integer
  into normalized_menu, selected_amount
  from jsonb_to_recordset(p_selected_menu) as item(id text, quantity integer)
  join public.restaurant_menu_catalog catalog
    on catalog.restaurant_id = post_row.restaurant_id
    and catalog.menu_id = item.id;

  select coalesce(sum(amount), 0)
  into existing_participant_amount
  from public.recruitment_menu_selections
  where post_id = post_row.id;

  base_amount := post_row.current_amount - existing_participant_amount;
  if base_amount < 0 then
    raise exception 'Stored order total is inconsistent with participant menu selections';
  end if;

  if jsonb_array_length(normalized_menu) = 0 then
    delete from public.recruitment_menu_selections
    where application_id = application_row.id;
  else
    insert into public.recruitment_menu_selections (
      application_id, post_id, applicant_id, applicant_name, selected_menu, amount, updated_at
    )
    values (
      application_row.id, post_row.id, application_row.applicant_id,
      application_row.applicant_name, normalized_menu, selected_amount, now()
    )
    on conflict (application_id) do update
    set applicant_name = excluded.applicant_name,
        selected_menu = excluded.selected_menu,
        amount = excluded.amount,
        updated_at = excluded.updated_at;
  end if;

  select coalesce(sum(amount), 0)
  into total_participant_amount
  from public.recruitment_menu_selections
  where post_id = post_row.id;

  update public.recruitment_posts
  set current_amount = (base_amount + total_participant_amount)::integer
  where id = post_row.id
  returning * into post_row;

  return post_row.current_amount;
end;
$$;

revoke all on function public.save_recruitment_menu_selection(uuid, jsonb) from public, anon;
grant execute on function public.save_recruitment_menu_selection(uuid, jsonb) to authenticated;
