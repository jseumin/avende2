alter table public.recruitment_posts
  add column if not exists restaurant_id text not null default '',
  add column if not exists selected_menu jsonb not null default '[]'::jsonb;
