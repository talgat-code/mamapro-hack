// Прод-запуск Telegram-бота Mama Pro: Supabase Edge Function, Telegram присылает апдейты webhook'ом.
// Логика — ../_shared/bot.mjs (та же, что у локального bot/index.js).
// Секреты функции: BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET. SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase задаёт сам.
// Деплой и установка webhook — DEPLOY.md («Telegram-бот»).
import { Bot, InlineKeyboard, session, webhookCallback } from "npm:grammy@1.46.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createBot, supabaseSessionStorage } from "../_shared/bot.mjs";

const token = Deno.env.get("BOT_TOKEN") ?? "";
const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function redact(text: string): string {
  let out = String(text);
  for (const s of [token, secret, sbKey]) if (s) out = out.split(s).join("***");
  return out;
}
function logError(where: string, err: unknown) {
  const e = err as { stack?: string };
  console.error(redact("[" + where + "] " + (e && e.stack ? e.stack : String(err))));
}

const missing = [["BOT_TOKEN", token], ["TELEGRAM_WEBHOOK_SECRET", secret], ["SUPABASE_URL", sbUrl], ["SUPABASE_SERVICE_ROLE_KEY", sbKey]]
  .filter(([, v]) => !v).map(([k]) => k);

let handle: ((req: Request) => Promise<Response>) | null = null;
if (missing.length === 0) {
  // service_role: заявки (leads) и состояние диалога (bot_sessions) пишутся в обход RLS, только с сервера.
  const supabase = createClient(sbUrl, sbKey, { auth: { persistSession: false } });
  const bot = createBot({
    Bot, InlineKeyboard, session, token, supabase, logError,
    storage: supabaseSessionStorage(supabase),
  });
  // secretToken: апдейт без заголовка X-Telegram-Bot-Api-Secret-Token с этим значением отклоняется (401).
  handle = webhookCallback(bot, "std/http", { secretToken: secret });
} else {
  console.error("Не заданы секреты функции: " + missing.join(", "));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (!handle) return new Response("not configured", { status: 500 });
  try {
    return await handle(req);
  } catch (err) {
    logError("webhook", err);
    // 200, чтобы Telegram не повторял один и тот же апдейт бесконечно; ошибка — в логах функции.
    return new Response("error logged");
  }
});
