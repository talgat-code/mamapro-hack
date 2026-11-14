-- Учётные записи I-Help: роли, профили, дети (минимум данных) и модерация карточек специалистов.
-- Опирается на таблицу public.specialists из 20261115120000_create_specialists.sql (демо-каталог бота).
-- Принципы:
--   * Вход на сайт без регистрации; кабинет — по желанию (Supabase Auth, email + пароль).
--   * Роль при регистрации — только parent или specialist. admin назначается вручную в SQL Editor
--     (см. конец файла), сам себе её никто выдать не может: колонка role закрыта от обновления.
--   * О ребёнке — только прозвище, возрастная группа, запрос и город. Без диагнозов и документов.
--     Ребёнка видит только его родитель; организаторы доступа к детям не имеют.
--   * Специалист не меняет карточку напрямую: он отправляет правку, организатор одобряет её.
--   * Демо-профили (is_demo = true) не трогаем: остаются опубликованными, бот читает их как раньше.

-- ---------- Роли и профили ----------
create type public.app_role as enum ('parent', 'specialist', 'admin');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.app_role not null default 'parent',
  full_name   text not null default '' check (char_length(full_name) <= 100),
  phone       text check (phone is null or char_length(phone) <= 30),
  city        text check (city is null or char_length(city) <= 60),
  consent_at  timestamptz not null default now(), -- согласие на обработку ПДн при регистрации
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Проверка роли без рекурсии RLS.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, city) on public.profiles to authenticated; -- role менять нельзя

-- ---------- Карточки специалистов: владелец и статус публикации ----------
alter table public.specialists
  add column user_id uuid unique references public.profiles (id) on delete set null,
  add column status text not null default 'published' check (status in ('draft', 'published', 'hidden'));

alter table public.specialists
  alter column id set default gen_random_uuid()::text,
  alter column formats set default array['on']::text[],
  alter column languages set default array['ru']::text[],
  alter column age_bands set default '{}'::text[];

-- Коды специальностей — как в supabase/functions/_shared/catalog.mjs.
create or replace function public.specialty_codes()
returns text[]
language sql immutable
as $$ select array['logoped', 'spec_pedagog', 'surdopedagog', 'tiflopedagog', 'child_psychologist', 'neuropsychologist',
  'child_psychiatrist', 'pediatrician', 'child_neurologist', 'geneticist', 'orthopedist', 'rehabilitologist',
  'lfk_instructor', 'ergotherapist', 'ophthalmologist', 'ent', 'audiologist', 'gastroenterologist',
  'endocrinologist', 'dietitian']::text[] $$;

-- Публично видны только опубликованные; черновик видит его владелец и организатор.
drop policy "specialists_read_public" on public.specialists;
create policy specialists_select on public.specialists for select to anon, authenticated
  using (status = 'published' or user_id = auth.uid() or public.is_admin());
create policy specialists_admin_insert on public.specialists for insert to authenticated
  with check (public.is_admin());
create policy specialists_admin_update on public.specialists for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy specialists_admin_delete on public.specialists for delete to authenticated
  using (public.is_admin());

grant insert, update, delete on public.specialists to authenticated; -- ограничено политиками admin

-- ---------- Правки карточек (модерация) ----------
create table public.specialist_changes (
  id             uuid primary key default gen_random_uuid(),
  specialist_id  text not null references public.specialists (id) on delete cascade,
  author_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  payload        jsonb not null, -- только display_name, specialty_code, city, formats, about (ru)
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note    text check (review_note is null or char_length(review_note) <= 300),
  reviewed_by    uuid references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);

alter table public.specialist_changes enable row level security;

create policy changes_select on public.specialist_changes for select to authenticated
  using (author_id = auth.uid() or public.is_admin());
create policy changes_insert_own on public.specialist_changes for insert to authenticated
  with check (
    author_id = auth.uid()
    and status = 'pending'
    and exists (select 1 from public.specialists s where s.id = specialist_id and s.user_id = auth.uid())
  );

revoke all on public.specialist_changes from anon, authenticated;
grant select on public.specialist_changes to authenticated;
grant insert (specialist_id, payload) on public.specialist_changes to authenticated;

-- Одобрение/отклонение правки — только организатор. Применяет разрешённые поля к карточке.
create or replace function public.review_specialist_change(change_id uuid, approve boolean, note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c public.specialist_changes;
  p jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into c from public.specialist_changes where id = change_id and status = 'pending' for update;
  if not found then
    raise exception 'change not found or already reviewed';
  end if;
  p := c.payload;

  if approve then
    if coalesce(p ->> 'specialty_code', '') <> '' and not (p ->> 'specialty_code') = any (public.specialty_codes()) then
      raise exception 'unknown specialty_code';
    end if;
    update public.specialists set
      display_name   = coalesce(nullif(left(p ->> 'display_name', 100), ''), display_name),
      specialty_code = coalesce(nullif(p ->> 'specialty_code', ''), specialty_code),
      city           = case when p ? 'city' then nullif(p ->> 'city', '') else city end,
      formats        = case when jsonb_typeof(p -> 'formats') = 'array' and jsonb_array_length(p -> 'formats') > 0
                            then array(select jsonb_array_elements_text(p -> 'formats')) else formats end,
      about          = case when p ? 'about' then about || jsonb_build_object('ru', left(p ->> 'about', 1000)) else about end,
      updated_at     = now()
    where id = c.specialist_id;
  end if;

  update public.specialist_changes
    set status = case when approve then 'approved' else 'rejected' end,
        review_note = left(note, 300),
        reviewed_by = auth.uid(),
        reviewed_at = now()
  where id = change_id;
end;
$$;

revoke all on function public.review_specialist_change(uuid, boolean, text) from public, anon;
grant execute on function public.review_specialist_change(uuid, boolean, text) to authenticated;

-- ---------- Дети (минимум данных, видит только родитель) ----------
create table public.children (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  nickname    text not null check (char_length(nickname) between 1 and 40),
  age_group   text not null check (age_group in ('до 3', '3–6', '7–12', '13+')),
  topics      text[] not null default '{}'
              check (topics <@ array['речь', 'поведение и эмоции', 'обучение и внимание', 'моторика и движение', 'не знаю']::text[]),
  city        text check (city is null or char_length(city) <= 60),
  guardian_consent_at timestamptz not null default now(), -- подтверждение законного представителя
  created_at  timestamptz not null default now()
);

alter table public.children enable row level security;

create policy children_own on public.children for all to authenticated
  using (parent_id = auth.uid()) with check (parent_id = auth.uid());

revoke all on public.children from anon, authenticated;
grant select, insert, update, delete on public.children to authenticated;

-- ---------- Заявки: привязка к кабинету ----------
alter table public.leads
  add column user_id uuid default auth.uid() references auth.users (id) on delete set null;

drop policy "leads_insert_public" on public.leads;
create policy "leads_insert_public"
  on public.leads
  for insert
  to anon, authenticated
  with check (
    char_length(name) between 1 and 100
    and char_length(contact) between 3 and 150
    and (message is null or char_length(message) <= 1000)
    and (user_id is null or user_id = auth.uid())
  );
create policy leads_select_own on public.leads for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select on public.leads to authenticated;

-- ---------- Профиль при регистрации ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r public.app_role := case when new.raw_user_meta_data ->> 'role' = 'specialist' then 'specialist' else 'parent' end;
  n text := left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 100);
begin
  insert into public.profiles (id, role, full_name) values (new.id, r, n);
  if r = 'specialist' then
    -- Черновик карточки: не виден публично, пока организатор не опубликует.
    insert into public.specialists (user_id, is_demo, display_name, specialty_code, status)
    values (new.id, false, coalesce(nullif(n, ''), 'Специалист'), 'logoped', 'draft');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Как назначить организатора ----------
-- Выполнить вручную в SQL Editor (service_role), подставив email:
--   update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'organizer@example.com');
