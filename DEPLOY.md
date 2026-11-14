# Деплой

Лендинг — статический HTML/CSS в `landing/` (Vercel). Бэкенд — Supabase (`supabase/`). Сборки нет.

## Лендинг (Vercel)
1. `npx vercel login`, затем `npx vercel link` (проект `mama-pro-landing`).
2. `npx vercel deploy --prod` — `vercel.json` отдаёт папку `landing/` как есть.

## База данных (Supabase)
1. `npx supabase login`, затем `npx supabase link --project-ref <ref>`.
2. `npx supabase db push` — применяет миграции из `supabase/migrations/`.
3. Новая миграция: `npx supabase migration new <имя>`, правим SQL, снова `db push`.
4. Edge-функции будут жить в `supabase/functions/`.

## Ключи
- В `landing/config.js` кладём только `SUPABASE_URL` и **anon key** (они публичные, защита — RLS).
- `service_role` key, пароль БД и токены не коммитим: только локальный `.env` (в `.gitignore`).
  Шаблон — `.env.example`.

## Заявки
Таблица `public.leads`: аноним может только добавлять строки (RLS). Читать заявки —
в дашборде Supabase (Table Editor) или через service_role на сервере.
