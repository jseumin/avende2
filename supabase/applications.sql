create table if not exists public.recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.recruitment_posts(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  applicant_name text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (post_id, applicant_id)
);

alter table public.recruitment_applications enable row level security;

drop policy if exists "Applicants and post owners can view applications" on public.recruitment_applications;
create policy "Applicants and post owners can view applications"
  on public.recruitment_applications for select to authenticated
  using (
    applicant_id = (select auth.uid())
    or exists (
      select 1
      from public.recruitment_posts
      where recruitment_posts.id = recruitment_applications.post_id
        and recruitment_posts.owner_id = (select auth.uid())
    )
  );

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
        and recruitment_posts.joined < recruitment_posts.max_participants
    )
  );

drop policy if exists "Applicants can withdraw pending applications" on public.recruitment_applications;
create policy "Applicants can withdraw pending applications"
  on public.recruitment_applications for delete to authenticated
  using (applicant_id = (select auth.uid()) and status = 'pending');

grant select, insert, delete on public.recruitment_applications to authenticated;

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
    if post_row.status <> 'open' or post_row.joined >= post_row.max_participants then
      raise exception 'Recruitment post is full or closed';
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
