// HTTP-API мини-аппа I-Help (Telegram Mini App). Один код для Edge Function (Deno) и локального сервера (Node):
// только стандартные Request/Response и WebCrypto.
//
//   POST { initData, action, ... }  — действия пользователя; initData проверяется подписью бота (HMAC-SHA256).
//   GET  ?action=specialist&id=...  — публичная карточка специалиста для страницы сайта (данные вымышленные).
//
// Логика — bot.miniapp (bot.mjs): та же сессия, анкета, обращения и уведомления сотрудникам, что и у чата.

const MAX_AGE_SEC = 24 * 3600; // initData старше суток не принимаем
const CORS = {
  "Access-Control-Allow-Origin": "*", // авторизация — подписью в теле запроса, не cookie
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400"
};

const enc = new TextEncoder();
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const hex = (buf) => Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");

// Проверка initData по документации Telegram: secret = HMAC("WebAppData", token), hash = HMAC(secret, data_check_string).
// Возвращает пользователя или null.
export async function verifyInitData(initData, token, nowSec) {
  if (typeof initData !== "string" || !initData || initData.length > 4096 || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = Array.from(params.entries()).map(([k, v]) => k + "=" + v).sort().join("\n");
  const secret = await hmac("WebAppData", token);
  const calc = hex(await hmac(secret, check));
  if (calc.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;
  const authDate = Number(params.get("auth_date"));
  const now = nowSec || Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > MAX_AGE_SEC) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    return user && Number.isInteger(user.id) ? user : null;
  } catch (_) {
    return null;
  }
}

// Подписать initData (для тестов и локальной проверки — тем же алгоритмом).
export async function signInitData(fields, token) {
  const params = new URLSearchParams(fields);
  const check = Array.from(params.entries()).map(([k, v]) => k + "=" + v).sort().join("\n");
  const secret = await hmac("WebAppData", token);
  params.set("hash", hex(await hmac(secret, check)));
  return params.toString();
}

const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, CORS)
});

export async function handleMiniappRequest(req, bot, token, logError) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const api = bot.miniapp;
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("action") === "specialist") {
        const id = String(url.searchParams.get("id") || "").slice(0, 20);
        const res = await api.specialist(id);
        return json(res, res.notFound ? 404 : 200);
      }
      return json({ error: "unknown action" }, 400);
    }
    if (req.method !== "POST") return json({ error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch (_) { return json({ error: "bad json" }, 400); }
    const user = await verifyInitData(body && body.initData, token);
    if (!user) return json({ error: "unauthorized" }, 401);
    switch (body.action) {
      case "boot": return json(await api.boot(user));
      case "save": return json(await api.save(user, body.patch));
      case "search": return json(await api.search(user));
      case "profiles": return json(await api.profiles(user, body.ids));
      case "submit": return json(await api.submit(user, body.kind, body.specId));
      case "requests": return json(await api.requests(user));
      case "request": return json(await api.request(user, body.id));
      case "cancel": return json(await api.cancel(user, body.id));
      case "respond": return json(await api.respond(user, body.id, body.ok));
      default: return json({ error: "unknown action" }, 400);
    }
  } catch (err) {
    if (logError) logError("miniapp", err);
    return json({ error: "server" }, 500);
  }
}
