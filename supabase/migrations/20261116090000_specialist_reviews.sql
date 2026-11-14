-- Отзывы родителей о специалистах (страница сайта specialist.html, ссылка из карточки в боте).
-- Сейчас — только вымышленные демо-отзывы (is_demo = true) к вымышленным демо-профилям; на странице они помечены.
-- Читать может кто угодно (опубликованные профили публичны), добавлять и менять — только service_role:
-- приём настоящих отзывов (модерация, подтверждение визита) — отдельная задача.
create table public.specialist_reviews (
  id            uuid primary key default gen_random_uuid(),
  specialist_id text not null references public.specialists (id) on delete cascade,
  is_demo       boolean not null default true,
  author        text not null check (char_length(author) between 1 and 60),
  city          text,
  child_age     text check (child_age is null or child_age in ('0-2', '3-5', '6-9', '10-13', '14-17', '18+')),
  rating        smallint not null check (rating between 1 and 5),
  lang          text not null default 'ru' check (lang in ('ru', 'kk')),
  body          text not null check (char_length(body) between 1 and 600),
  created_on    date not null default current_date,
  created_at    timestamptz not null default now()
);

create index specialist_reviews_specialist on public.specialist_reviews (specialist_id, created_on desc);

alter table public.specialist_reviews enable row level security;
create policy specialist_reviews_read on public.specialist_reviews for select to anon, authenticated using (true);
revoke all on public.specialist_reviews from anon, authenticated;
grant select on public.specialist_reviews to anon, authenticated;
grant select, insert, update, delete on public.specialist_reviews to service_role;
