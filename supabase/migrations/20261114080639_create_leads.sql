-- Заявки с лендинга. Анонимные посетители могут только создавать записи.
create table public.leads (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  contact    text not null,
  message    text,
  created_at timestamptz not null default now(),

  constraint leads_name_len    check (char_length(name) between 1 and 100),
  constraint leads_contact_len check (char_length(contact) between 3 and 150),
  constraint leads_message_len check (message is null or char_length(message) <= 1000)
);

alter table public.leads enable row level security;

-- Только INSERT для anon и authenticated. Политик на SELECT/UPDATE/DELETE нет,
-- значит они запрещены (читать заявки можно только через service_role / дашборд).
create policy "leads_insert_public"
  on public.leads
  for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 100
    and char_length(contact) between 3 and 150
    and (message is null or char_length(message) <= 1000)
  );

-- Явно убираем лишние права на уровне GRANT (вторая линия защиты помимо RLS).
revoke all on public.leads from anon, authenticated;
grant insert on public.leads to anon, authenticated;
