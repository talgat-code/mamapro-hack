-- Обращения из Telegram-бота (сценарий mama.md): психологическая поддержка и обращение к специалисту.
-- snapshot — сведения на момент отправки (не переписываются при изменении анкеты).
-- Статусы: accepted — принято, proposed — предложено время, confirmed — встреча подтверждена,
-- answered — есть ответ специалиста, cancelled — отменено.
-- Пишет и читает только Edge Function telegram-bot с service_role. Для anon/authenticated доступа нет.
create table public.bot_requests (
  id         uuid primary key default gen_random_uuid(),
  chat_id    bigint not null,
  kind       text not null check (kind in ('support', 'specialist')),
  status     text not null default 'accepted'
             check (status in ('accepted', 'proposed', 'confirmed', 'answered', 'cancelled')),
  snapshot   jsonb not null,
  proposal   text check (proposal is null or char_length(proposal) <= 300),
  answer     text check (answer is null or char_length(answer) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bot_requests_chat_created on public.bot_requests (chat_id, created_at desc);

alter table public.bot_requests enable row level security;
-- Политик нет: anon и authenticated не могут ничего. service_role обходит RLS.
revoke all on public.bot_requests from anon, authenticated;
grant select, insert, update on public.bot_requests to service_role;
