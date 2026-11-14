"use strict";

// Офлайн-проверка виджета: загружает настоящий bot/index.js с подменённым транспортом grammY (без сети и токена)
// и прогоняет апдейты через bot.handleUpdate.
//   node bot/widget/selftest.js        — с WIDGETS_ENABLED=1
//   node bot/widget/selftest.js off    — без флага: поведение бота прежнее

const assert = require("assert");
const path = require("path");
const grammy = require("grammy");

const OFF = process.argv[2] === "off";
process.env.BOT_TOKEN = "123:offline-selftest";
process.env.SUPABASE_URL = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.BOT_SKIP_WEBHOOK_CHECK = "1";
if (OFF) delete process.env.WIDGETS_ENABLED; else process.env.WIDGETS_ENABLED = "1";
process.argv.push("--env", ".env.selftest-none");

var bot = null, startOptions = null, started;
const ready = new Promise(function (r) { started = r; });
grammy.Bot.prototype.start = function (opts) { bot = this; startOptions = opts; started(); return Promise.resolve(); };

const calls = [];
var nextId = 100;
var editFailure = null;
const origLog = console.log, origWarn = console.warn;
const logs = [];
console.log = function () { logs.push([].join.call(arguments, " ")); };
console.warn = function () {};

require(path.join(__dirname, "..", "index.js"));

async function boot() {
await ready;
bot.botInfo = { id: 1, is_bot: true, first_name: "Test", username: "mamapro_test_bot" };

bot.api.config.use(async function (prev, method, payload) {
  calls.push({ method: method, payload: payload });
  if (method === "editMessageWidgetData" && editFailure) {
    var e = new grammy.GrammyError("Call to '" + method + "' failed!", { ok: false, error_code: 400, description: editFailure }, method, payload);
    throw e;
  }
  var result = true;
  if (method === "sendWidget" || method === "sendMessage" || method === "sendPhoto") result = { message_id: nextId++, chat: { id: payload.chat_id }, date: 0 };
  return { ok: true, result: result };
});
}

const ME = { id: 1001, is_bot: false, first_name: "Ann" };
const CHAT = { id: 1001, type: "private", first_name: "Ann" };
var uid = 1;
function msg(text) {
  var m = { message_id: nextId++, from: ME, chat: CHAT, date: 0, text: text };
  if (text[0] === "/") m.entities = [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }];
  return { update_id: uid++, message: m };
}
function wq(data, extra) {
  return { update_id: uid++, widget_query: Object.assign({ id: "q" + uid, from: ME, chat: CHAT, message_id: 100, chat_instance: "ci", chat_type: "private", data: data }, extra || {}) };
}
async function run(update) { calls.length = 0; await bot.handleUpdate(update); return calls.slice(); }
function answerOf(cs) {
  var a = cs.filter(function (c) { return c.method === "answerWidgetQuery"; });
  assert.strictEqual(a.length, 1, "ровно один answerWidgetQuery, получено " + a.length);
  assert(Buffer.byteLength(a[0].payload.data) <= 1024, "ответ > 1024 байт");
  return JSON.parse(a[0].payload.data);
}
function editOf(cs) { return cs.filter(function (c) { return c.method === "editMessageWidgetData"; })[0]; }

const results = [];
async function check(name, fn) {
  try { await fn(); results.push("ok   " + name); }
  catch (e) { results.push("FAIL " + name + ": " + e.message); process.exitCode = 1; }
}

(async function () {
  await boot();
  if (OFF) {
    await check("без флага allowed_updates не передаётся", function () {
      assert.strictEqual(startOptions.allowed_updates, undefined);
    });
    await check("без флага /widget — неизвестная команда", async function () {
      var cs = await run(msg("/widget"));
      assert.deepStrictEqual(cs.map(function (c) { return c.method; }), ["sendPhoto"]);
      assert(/I-HELP/.test(cs[0].payload.caption)); // язык не выбран → приветствие с выбором языка
    });
    await check("без флага widget_query игнорируется", async function () {
      var cs = await run(wq("a:1|1,,,"));
      assert.strictEqual(cs.length, 0);
    });
  } else {
    await check("allowed_updates = умолчания grammY + widget_query, shared_widget_query", function () {
      var au = startOptions.allowed_updates;
      grammy.API_CONSTANTS.DEFAULT_UPDATE_TYPES.forEach(function (t) { assert(au.indexOf(t) !== -1, t); });
      assert(au.indexOf("widget_query") !== -1 && au.indexOf("shared_widget_query") !== -1);
    });

    await check("/widget → sendWidget с состоянием и подписью", async function () {
      var cs = await run(msg("/widget"));
      var sw = cs.filter(function (c) { return c.method === "sendWidget"; })[0];
      assert(sw, "нет sendWidget: " + JSON.stringify(cs.map(function (c) { return c.method; })));
      assert.strictEqual(sw.payload.allow_queries, true);
      assert(sw.payload.caption && sw.payload.html.length > 1000);
      assert.deepStrictEqual(JSON.parse(sw.payload.chat_data), { s: 1, a: null, t: [], f: null });
      var p = JSON.parse(sw.payload.public_data);
      assert.strictEqual(p.o.a.length, 4); assert.strictEqual(p.o.t.length, 5); assert.strictEqual(p.u, "mamapro_test_bot");
      assert(Buffer.byteLength(sw.payload.public_data) <= 1024);
    });

    await check("/start по-прежнему работает", async function () {
      var cs = await run(msg("/start"));
      assert.strictEqual(cs[0].method, "sendPhoto");
      assert(/I-HELP/.test(cs[0].payload.caption)); // приветствие I-HELP × MamaPro с выбором языка
    });

    var flow = [
      ["a:2|1,,,", { s: 2, a: 2, t: [], f: null }],
      ["t:1|2,2,,", { s: 2, a: 2, t: [1], f: null }],
      ["t:2|2,2,1,", { s: 2, a: 2, t: [1, 2], f: null }],
      ["t:4|2,2,12,", { s: 2, a: 2, t: [4], f: null }],
      ["t:1|2,2,4,", { s: 2, a: 2, t: [1], f: null }],
      ["t:2|2,2,1,", { s: 2, a: 2, t: [1, 2], f: null }],
      ["n|2,2,12,", { s: 3, a: 2, t: [1, 2], f: null }],
      ["b|3,2,12,", { s: 2, a: 2, t: [1, 2], f: null }],
      ["n|2,2,12,", { s: 3, a: 2, t: [1, 2], f: null }],
      ["f:0|3,2,12,", { s: 4, a: 2, t: [1, 2], f: 0 }]
    ];
    for (var i = 0; i < flow.length; i++) {
      await (function (step) {
        return check("запрос " + step[0] + " → chatData " + JSON.stringify(step[1]), async function () {
          var cs = await run(wq(step[0]));
          var ed = editOf(cs);
          assert(ed, "нет editMessageWidgetData");
          assert.strictEqual(ed.payload.chat_id, 1001); assert.strictEqual(ed.payload.message_id, 100);
          assert.deepStrictEqual(JSON.parse(ed.payload.chat_data), step[1]);
          assert(Buffer.byteLength(ed.payload.public_data) <= 1024, "public_data > 1024");
          assert(cs.indexOf(ed) < cs.map(function (c) { return c.method; }).indexOf("answerWidgetQuery"), "ответ раньше edit");
          var a = answerOf(cs);
          assert.deepStrictEqual(a.c, step[1]);
        });
      })(flow[i]);
    }

    await check("результат: рекомендация в publicData, размер", async function () {
      var cs = await run(wq("f:0|3,2,12,"));
      var p = JSON.parse(editOf(cs).payload.public_data);
      assert.strictEqual(p.r.length, 2);
      assert.deepStrictEqual(p.r.map(function (x) { return x[0]; }), ["психолог", "нейропсихолог"]);
      assert(p.n, "нет пояснения о сокращении списка");
      results.push("     public_data на результате: " + Buffer.byteLength(editOf(cs).payload.public_data) + " байт");
    });

    await check("«Не знаю» → дефектолог и пояснение", async function () {
      var p = JSON.parse(editOf(await run(wq("f:2|3,0,4,"))).payload.public_data);
      assert.deepStrictEqual(p.r.map(function (x) { return x[0]; }), ["дефектолог"]);
      assert(/дефектолога/.test(p.n));
    });

    await check("заново → чистое состояние, рекомендация убрана из publicData", async function () {
      var cs = await run(wq("r|4,2,12,0"));
      assert.deepStrictEqual(JSON.parse(editOf(cs).payload.chat_data), { s: 1, a: null, t: [], f: null });
      assert.strictEqual(JSON.parse(editOf(cs).payload.public_data).r, undefined);
    });

    await check("заявка из виджета → сообщение в чате, дальше обычный сценарий бота", async function () {
      var cs = await run(wq("l|4,2,12,0"));
      var sm = cs.filter(function (c) { return c.method === "sendMessage"; })[0];
      assert(sm && /Қай тіл|Чем помочь дальше/.test(sm.payload.text), "нет сообщения в чате");
      assert(answerOf(cs).m);
    });

    await check("заявка до конца опроса → ошибка", async function () {
      assert(answerOf(await run(wq("l|2,2,1,"))).err);
    });

    await check("мусорные данные → err, ответ есть", async function () {
      var cs = await run(wq("zzz"));
      assert(answerOf(cs).err); assert(!editOf(cs));
    });
    await check("подделанное состояние (тема 7) → err", async function () {
      assert(answerOf(await run(wq("t:1|2,1,7,"))).err);
    });
    await check("шаг впереди ответов нормализуется", async function () {
      var a = answerOf(await run(wq("b|4,1,,")));
      assert.strictEqual(a.c.s, 1);
    });
    await check("«message is not modified» считается успехом", async function () {
      editFailure = "Bad Request: message is not modified";
      var a = answerOf(await run(wq("a:2|1,,,")));
      editFailure = null;
      assert(a.c && !a.err);
    });
    await check("ошибка edit → ответ {err}, но ответ отправлен", async function () {
      editFailure = "Bad Request: message to edit not found";
      var a = answerOf(await run(wq("a:2|1,,,")));
      editFailure = null;
      assert(a.err && !a.c);
    });
    await check("shared_widget_query → {err}, ответ отправлен", async function () {
      var cs = await run({ update_id: uid++, shared_widget_query: { id: "s1", from: ME, data: "a:1|1,,,", widget_id: "w" } });
      assert(answerOf(cs).err);
    });
    await check("/widget в группе → отказ без sendWidget", async function () {
      var m = msg("/widget"); m.message.chat = { id: -5, type: "group", title: "g" };
      var cs = await run(m);
      assert(!cs.some(function (c) { return c.method === "sendWidget"; }));
    });
    await check("в логах нет токена", function () {
      assert(!logs.join("\n").includes(process.env.BOT_TOKEN));
    });
  }
  console.log = origLog; console.warn = origWarn;
  console.log(results.join("\n"));
  console.log("\nлог бота:\n  " + logs.join("\n  "));
})();
