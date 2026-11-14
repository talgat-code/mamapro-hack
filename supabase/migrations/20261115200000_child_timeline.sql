-- Карточка ребёнка, дневник наблюдений и маршрут новичка в Telegram-боте.
-- Имена с префиксом bot_: таблица public.children уже есть (кабинеты сайта, 20261115170000_accounts_roles.sql),
-- а таблицы бота живут отдельно и привязаны к chat_id, а не к учётной записи сайта.
--
-- Это сведения о здоровье ребёнка (диагнозы, лекарства, аллергии). Поэтому, как у bot_requests и bot_sessions:
-- RLS включён без политик, anon/authenticated доступа нет. Пишет и читает только Edge Function telegram-bot
-- с service_role. Anon key публичный (он есть в landing/config.js), открывать ему эти таблицы нельзя.
-- Удаление карточки в боте удаляет ребёнка, его специалистов и дневник (on delete cascade).

create table public.bot_children (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  name        text not null check (char_length(name) between 1 and 40),
  age_group   text check (age_group is null or age_group in ('under1', '1-3', '3-5', '5-7', 'over7')),
  diagnoses   text[] not null default '{}' check (cardinality(diagnoses) <= 10),
  allergies   text check (allergies is null or char_length(allergies) <= 300),
  medications text check (medications is null or char_length(medications) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index bot_children_chat on public.bot_children (chat_id, created_at desc);

create table public.bot_child_specialists (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.bot_children (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  specialty  text not null check (char_length(specialty) between 1 and 60),
  schedule   text check (schedule is null or char_length(schedule) <= 100),
  created_at timestamptz not null default now()
);

create index bot_child_specialists_child on public.bot_child_specialists (child_id);

create table public.bot_diary_entries (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.bot_children (id) on delete cascade,
  date       date not null default current_date,
  mood       text not null check (mood in ('good', 'normal', 'bad')),
  tags       text[] not null default '{}'
             check (tags <@ array['new_word', 'tantrum', 'bad_sleep', 'bad_eat', 'medicine', 'homework']::text[]),
  note       text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index bot_diary_entries_child_date on public.bot_diary_entries (child_id, date);

create table public.bot_newbie_routes (
  id                 uuid primary key default gen_random_uuid(),
  chat_id            bigint not null,
  child_age          text,
  concern            text,
  been_to_specialist text,
  budget             text,
  route_text         text check (route_text is null or char_length(route_text) <= 4000),
  created_at         timestamptz not null default now()
);

alter table public.bot_children enable row level security;
alter table public.bot_child_specialists enable row level security;
alter table public.bot_diary_entries enable row level security;
alter table public.bot_newbie_routes enable row level security;
-- Политик нет: anon и authenticated не могут ничего. service_role обходит RLS.

revoke all on public.bot_children, public.bot_child_specialists, public.bot_diary_entries, public.bot_newbie_routes
  from anon, authenticated;
grant select, insert, update, delete on public.bot_children, public.bot_child_specialists, public.bot_diary_entries
  to service_role;
grant select, insert on public.bot_newbie_routes to service_role;
