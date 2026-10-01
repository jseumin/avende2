create or replace function public.close_recruitment_post(p_post_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_owner uuid;
  current_deadline timestamptz;
  closed_at timestamptz := now();
begin
  select owner_id, deadline_at
  into post_owner, current_deadline
  from public.recruitment_posts
  where id = p_post_id
  for update;

  if not found then
    raise exception 'Recruitment post not found';
  end if;
  if post_owner is distinct from (select auth.uid()) then
    raise exception 'Only the post owner can close this recruitment post';
  end if;
  if current_deadline <= closed_at then
    raise exception 'Recruitment post is already closed';
  end if;

  update public.recruitment_posts
  set deadline_at = closed_at,
      deadline = '조기 마감'
  where id = p_post_id;

  return closed_at;
end;
$$;

revoke all on function public.close_recruitment_post(uuid) from public, anon;
grant execute on function public.close_recruitment_post(uuid) to authenticated;
