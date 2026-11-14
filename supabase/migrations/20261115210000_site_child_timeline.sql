-- Сайт (кабинет родителя): карточка ребёнка, специалисты ребёнка и дневник наблюдений.
-- Аналог таблиц бота (20261115200000_child_timeline.sql), но для учётных записей сайта:
-- ребёнок — public.children из 20261115170000_accounts_roles.sql (parent_id = auth.uid()).
-- Сведения о здоровье необязательны. Видит и меняет их только родитель; у организаторов доступа нет.

alter table public.children
  add column diagnoses   text[] not null default '{}' check (cardinality(diagnoses) <= 10),
  add column allergies   text check (allergies is null or char_length(allergies) <= 300),
  add column medications text check (medications is null or char_length(medications) <= 300);

-- Проверка «ребёнок принадлежит текущему пользователю» для дочерних таблиц.
create or replace function public.owns_child(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.children where id = cid and parent_id = auth.uid()) $$;

create table public.child_specialists (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.children (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  specialty  text not null check (char_length(specialty) between 1 and 60),
  schedule   text check (schedule is null or char_length(schedule) <= 100),
  created_at timestamptz not null default now()
);

create table public.diary_entries (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.children (id) on delete cascade,
  date       date not null default current_date,
  mood       text not null check (mood in ('good', 'normal', 'bad')),
  tags       text[] not null default '{}'
             check (tags <@ array['new_word', 'tantrum', 'bad_sleep', 'bad_eat', 'medicine', 'homework']::text[]),
  note       text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index child_specialists_child on public.child_specialists (child_id);
create index diary_entries_child_date on public.diary_entries (child_id, date);

alter table public.child_specialists enable row level security;
alter table public.diary_entries enable row level security;

create policy child_specialists_own on public.child_specialists for all to authenticated
  using (public.owns_child(child_id)) with check (public.owns_child(child_id));
create policy diary_entries_own on public.diary_entries for all to authenticated
  using (public.owns_child(child_id)) with check (public.owns_child(child_id));

revoke all on public.child_specialists, public.diary_entries from anon, authenticated;
grant select, insert, update, delete on public.child_specialists, public.diary_entries to authenticated;
