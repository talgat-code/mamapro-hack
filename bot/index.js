"use strict";

// Локальный запуск Telegram-бота Mama Pro: long polling, состояние диалога и обращения в памяти.
// Логика бота — supabase/functions/_shared/bot.mjs; в проде она же работает как Supabase Edge Function (webhook).
//
//   node index.js                     — с .env в корне репозитория
//   node index.js --env .env.test     — с другим файлом окружения
//   node index.js --force-polling     — запустить, даже если у бота стоит webhook (прод): grammY его удалит!
const path = require("path");
const { pathToFileURL } = require("url");
const ENV_ARG = process.argv.indexOf("--env");
const ENV_FILE = ENV_ARG !== -1 && process.argv[ENV_ARG + 1] ? process.argv[ENV_ARG + 1] : ".env";
require("dotenv").config({ path: path.join(__dirname, "..", ENV_FILE) });
const { Bot, InlineKeyboard, InputFile, session, API_CONSTANTS } = require("grammy");
const { createClient } = require("@supabase/supabase-js");

const { BOT_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY, BOT_API_BASE, BOT_TEST_ENV, STAFF_CHAT_ID, MINIAPP_URL } = process.env;
// Эксперимент с виджетами (bot/widget): выключен, пока не задано WIDGETS_ENABLED=1.
const WIDGETS_ENABLED = process.env.WIDGETS_ENABLED === "1";
const FORCE_POLLING = process.argv.indexOf("--force-polling") !== -1;

if (!BOT_TOKEN) {
  console.error("Не задан BOT_TOKEN: добавьте его в .env в корне репозитория (см. .env.example).");
  process.exit(1);
}

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;
if (!supabase) console.warn("SUPABASE_URL / SUPABASE_ANON_KEY не заданы — копии обращений в leads сохраняться не будут.");

// ---------- Логирование без секретов ----------
function redact(text) {
  var out = String(text);
  [BOT_TOKEN, SUPABASE_ANON_KEY].forEach(function (secret) {
    if (secret) out = out.split(secret).join("***");
  });
  return out;
}
function logError(where, err) {
  console.error(redact("[" + where + "] " + (err && err.stack ? err.stack : err)));
}

// Адрес Bot API меняется только если задан в env (бета, тестовое окружение); по умолчанию — обычный.
const clientConfig = {};
if (BOT_API_BASE) clientConfig.apiRoot = BOT_API_BASE.replace(/\/+$/, "");
if (BOT_TEST_ENV === "1") clientConfig.environment = "test";

async function main() {
  const shared = await import(pathToFileURL(path.join(__dirname, "..", "supabase", "functions", "_shared", "bot.mjs")).href);
  const bot = shared.createBot({
    Bot: Bot,
    InlineKeyboard: InlineKeyboard,
    InputFile: InputFile,
    session: session,
    token: BOT_TOKEN,
    botConfig: Object.keys(clientConfig).length ? { client: clientConfig } : undefined,
    supabase: supabase,
    // Демо-профили специалистов из public.specialists (чтение открыто); без Supabase — встроенный запасной набор.
    loadSpecialists: supabase ? shared.supabaseSpecialistSource(supabase) : null,
    staffChatId: STAFF_CHAT_ID,
    miniappUrl: MINIAPP_URL,
    logError: logError,
    extend: WIDGETS_ENABLED ? function (b, d) { require("./widget").setupWidgets(b, d); } : null
  });

  // bot.start() удаляет webhook. Если он стоит — значит, работает прод (Edge Function), и его трогать нельзя.
  if (!FORCE_POLLING && !process.env.BOT_SKIP_WEBHOOK_CHECK) {
    const info = await bot.api.getWebhookInfo();
    if (info.url) {
      console.error("У бота настроен webhook — бот работает в проде (Supabase Edge Function).\n" +
        "Локальный polling удалил бы webhook и отключил прод. Для локальной разработки используйте отдельного бота\n" +
        "(другой BOT_TOKEN в --env файле). Если точно нужно: --force-polling, затем снова setWebhook (DEPLOY.md).");
      process.exit(1);
    }
  }

  process.once("SIGINT", function () { bot.stop(); });
  process.once("SIGTERM", function () { bot.stop(); });

  const startOptions = {
    onStart: function (me) { console.log("Бот @" + me.username + " запущен (long polling). Остановка: Ctrl+C."); }
  };
  // Новые типы апдейтов добавляются к умолчаниям grammY; без флага allowed_updates не передаётся.
  if (WIDGETS_ENABLED) startOptions.allowed_updates = API_CONSTANTS.DEFAULT_UPDATE_TYPES.concat(require("./widget").UPDATE_TYPES);
  await bot.start(startOptions);
}

process.on("unhandledRejection", function (e) { logError("unhandledRejection", e); });
main().catch(function (e) {
  logError("start", e);
  process.exit(1);
});
