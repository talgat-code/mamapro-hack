-- Состояние диалога Telegram-бота (сессии grammY по chat.id): шаг опроса, ответы, черновик заявки.
-- Пишет и читает только Edge Function telegram-bot с service_role. Для anon/authenticated доступа нет.
create table public.bot_sessions (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.bot_sessions enable row level security;
-- Политик нет: anon и authenticated не могут ничего. service_role обходит RLS.
revoke all on public.bot_sessions from anon, authenticated;
grant select, insert, update, delete on public.bot_sessions to service_role;

-- Бот в проде пишет заявки с service_role (Edge Function), а не с anon.
grant insert on public.leads to service_role;
