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

## Telegram-бот (Supabase Edge Function)
Прод: функция `supabase/functions/telegram-bot`, Telegram присылает апдейты webhook'ом. Логика бота —
`supabase/functions/_shared/bot.mjs` (сценарий — `mama.md`, тексты RU/KZ — `_shared/catalog.mjs`), состояние диалога —
таблица `public.bot_sessions`, обращения — `public.bot_requests` (копия — в `leads`); обе таблицы только для service_role.
Значения ниже — из локального `.env` (`BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`).
1. `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push` (миграции `bot_sessions`, `bot_requests`).
2. `npx supabase secrets set BOT_TOKEN=<токен> TELEGRAM_WEBHOOK_SECRET=<секрет> STAFF_CHAT_ID=<id>`.
   `STAFF_CHAT_ID` — служебный чат сотрудников: туда приходят обращения с кнопками «Предложить время» /
   «Специалист готов» / «Другой ответ»; сотрудник отвечает реплаем, родитель получает уведомление.
   id чата покажет команда `/chatid` (написать боту в этом чате; в группе бот видит только команды и реплаи).
   Без `STAFF_CHAT_ID` обращения сохраняются, но ответить на них из Telegram нельзя.
3. `npx supabase functions deploy telegram-bot --use-api` (JWT выключен в `config.toml`: проверяется секрет webhook).
4. Webhook (один раз):
   `curl -s "https://api.telegram.org/bot<токен>/setWebhook" -d url=https://<ref>.supabase.co/functions/v1/telegram-bot -d secret_token=<секрет>`.
   Проверка: `.../getWebhookInfo` (поле `url`, нет `last_error_message`), затем `/start` боту.
5. Логи: дашборд Supabase → Edge Functions → telegram-bot → Logs.

Локально (`cd bot && npm ci && node index.js`) — long polling, состояние в памяти. Пока у бота стоит webhook,
локальный запуск откажется стартовать, чтобы не отключить прод: для разработки используйте отдельного бота
(`node index.js --env .env.dev` со своим `BOT_TOKEN`).

## Мини-апп I-Help (Telegram Mini App)
Всё после приветствия в чате — в мини-аппе: `landing/app/` (статика на сайте, Vercel). Полная анкета специалиста —
страница сайта `landing/specialist.html?id=…`. API — та же функция бота: `…/functions/v1/telegram-bot/api`
(`supabase/functions/_shared/miniapp-http.mjs`): POST с `initData` (подпись Telegram проверяется токеном бота,
данные старше суток отклоняются), GET `?action=specialist&id=` — публично, для страницы сайта.
1. Выложить сайт: `npx vercel deploy --prod` (папка `landing/`).
2. `npx supabase secrets set MINIAPP_URL=https://<сайт>/app/` — приветствие откроет мини-апп
   (без секрета остаётся прежний сценарий в чате).
3. Кнопка меню чата (один раз):
   `curl -s "https://api.telegram.org/bot<токен>/setChatMenuButton" -H "content-type: application/json" -d '{"menu_button":{"type":"web_app","text":"I-Help","web_app":{"url":"https://<сайт>/app/"}}}'`.
Адрес API для мини-аппа и страницы сайта — `landing/app/env.js`.

## Демо-специалисты
Таблица `public.specialists` — 536 вымышленных профилей (`is_demo = true`), чтение открыто, запись только service_role.
Набор генерирует `supabase/demo/gen_specialists.py` (детерминированно): у каждой комбинации условий поиска есть хотя бы
один специалист, принимающий обращения (кроме «Другой город» + «Очно»). Генератор сам проверяет покрытие и падает,
если оно нарушено. После правок генератора — новая миграция данных (удаляет демо-строки и вставляет заново):
`python supabase/demo/gen_specialists.py > supabase/migrations/<дата>_<имя>.sql`.
Бот читает профили с кэшем на минуту; если таблица недоступна — встроенный запасной набор из `catalog.mjs`.

## Заявки
Таблица `public.leads`: аноним может только добавлять строки (RLS). Читать заявки —
в дашборде Supabase (Table Editor) или через service_role на сервере.
