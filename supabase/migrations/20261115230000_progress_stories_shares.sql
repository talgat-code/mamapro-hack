-- Прогресс в Telegram-боте: истории семей (демо) и доступ специалиста к дневнику ребёнка.
--
-- family_stories — вымышленные истории семей с прогрессом по неделям («как менялось состояние»).
--   Данные выдуманы (is_demo = true), поэтому читать их может кто угодно; менять — только service_role.
--   weeks: [{ start: "YYYY-MM-DD", good, normal, bad, new_word, tantrum, bad_sleep, bad_eat, homework }] — счётчики за неделю,
--   тот же смысл, что у отметок дневника (bot_diary_entries). Тексты — { ru, kk }.
--
-- bot_child_shares — код доступа, который родитель даёт своему специалисту. Код привязывается к первому, кто его ввёл;
--   специалист видит дневник и прогресс ребёнка (без диагнозов, лекарств и аллергий), родитель может отозвать доступ.
--   Сведения о здоровье ребёнка: RLS без политик, только service_role (как bot_children).

create table public.family_stories (
  id           text primary key,
  is_demo      boolean not null default true,
  published    boolean not null default true,
  sort         integer not null default 0,
  title        jsonb not null,
  child_name   text not null check (char_length(child_name) between 1 and 40),
  age_group    text not null check (age_group in ('under1', '1-3', '3-5', '5-7', 'over7')),
  concern      jsonb not null,
  specialists  jsonb not null default '[]'::jsonb,
  started_on   date not null,
  summary      jsonb not null,
  helped       jsonb not null,
  milestones   jsonb not null default '[]'::jsonb,
  weeks        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

alter table public.family_stories enable row level security;
create policy family_stories_read on public.family_stories for select to anon, authenticated using (published);
revoke all on public.family_stories from anon, authenticated;
grant select on public.family_stories to anon, authenticated;
grant select, insert, update, delete on public.family_stories to service_role;

create table public.bot_child_shares (
  id             uuid primary key default gen_random_uuid(),
  child_id       uuid not null references public.bot_children (id) on delete cascade,
  code           text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  viewer_chat_id bigint,
  viewer_name    text check (viewer_name is null or char_length(viewer_name) <= 100),
  created_at     timestamptz not null default now(),
  claimed_at     timestamptz,
  revoked_at     timestamptz
);

create index bot_child_shares_child on public.bot_child_shares (child_id);
create index bot_child_shares_viewer on public.bot_child_shares (viewer_chat_id) where revoked_at is null;

alter table public.bot_child_shares enable row level security;
revoke all on public.bot_child_shares from anon, authenticated;
grant select, insert, update, delete on public.bot_child_shares to service_role;
