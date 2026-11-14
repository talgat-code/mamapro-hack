"use strict";

// Шаг 0 эксперимента с виджетами: проверка доступа к бета-методам Bot API 10.4.
// Без зависимостей (Node 18+, встроенный fetch). Читает только .env.test в корне репозитория.
// Печатает сырые ответы API; токен в выводе заменяется на ***.
//
//   node bot/widget/probe.js            — getMe, затем sendWidget в CHAT_ID (или в последний чат из getUpdates)
//   node bot/widget/probe.js <chat_id>  — то же, но в указанный чат
//
// Нужны в .env.test: BOT_TOKEN (тестовый бот), BOT_API_BASE=https://api.telegram.org/beta, BOT_TEST_ENV=1,
// опционально CHAT_ID. Не запускать на токене, который уже читает другой процесс (getUpdates).

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, "..", "..", ".env.test");

function loadEnv(file) {
  var vals = {};
  if (!fs.existsSync(file)) {
    console.error("Нет файла " + file + " — создайте его: BOT_TOKEN, BOT_API_BASE, BOT_TEST_ENV=1, CHAT_ID (опц.).");
    process.exit(1);
  }
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach(function (line) {
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && line.trim().charAt(0) !== "#") vals[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  });
  return vals;
}

const env = loadEnv(ENV_FILE);
const TOKEN = env.BOT_TOKEN;
if (!TOKEN) { console.error("В .env.test нет BOT_TOKEN"); process.exit(1); }
const BASE = (env.BOT_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
const URL_PREFIX = BASE + "/bot" + TOKEN + (env.BOT_TEST_ENV === "1" ? "/test" : "");

function redact(s) { return String(s).split(TOKEN).join("***"); }

async function call(method, params) {
  var shown = redact(URL_PREFIX) + "/" + method;
  console.log("\n>>> POST " + shown + (params ? "\n" + JSON.stringify(params) : ""));
  var res, text;
  try {
    res = await fetch(URL_PREFIX + "/" + method, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params || {})
    });
    text = await res.text();
  } catch (e) {
    console.log("<<< сетевая ошибка: " + redact(e && e.message));
    return null;
  }
  console.log("<<< HTTP " + res.status + "\n" + redact(text));
  try { return JSON.parse(text); } catch (e) { return null; }
}

(async function main() {
  console.log("Эндпоинт: " + redact(URL_PREFIX) + "/<method>");

  var me = await call("getMe");
  if (!me || !me.ok) { console.log("\nСтоп: getMe не прошёл — токен не подходит к этому эндпоинту."); return; }

  var chatId = process.argv[2] || env.CHAT_ID;
  if (!chatId) {
    var upd = await call("getUpdates", { timeout: 0, allowed_updates: ["message"] });
    var list = (upd && upd.ok && upd.result) || [];
    for (var i = list.length - 1; i >= 0 && !chatId; i--) {
      if (list[i].message && list[i].message.chat) chatId = list[i].message.chat.id;
    }
    if (!chatId) {
      console.log("\nСтоп: не знаю, куда отправлять. Напишите тестовому боту /start из тестового аккаунта и запустите снова, " +
        "или передайте chat_id аргументом / CHAT_ID в .env.test.");
      return;
    }
  }

  await call("sendWidget", {
    chat_id: chatId,
    html: "<b>hello</b>",
    width: 0,
    height: 0,
    caption: "Mama Pro: пробный виджет"
  });
})();
