"use strict";

// Эксперимент: опрос «Подобрать специалиста» как Telegram-виджет (Bot API 10.4: sendWidget, widget_query,
// editMessageWidgetData, answerWidgetQuery). Подключается из bot/index.js только при WIDGETS_ENABLED=1.
//
// Протокол (виджет — bot/widget/quiz.html):
//   chatData   {s,a,t,f}: шаг 1–3 вопросы, 4 результат; a — индекс возраста, t — индексы тем, f — индекс формата.
//   publicData {o:{a,t,f},u,r?,n?}: подписи вариантов, username бота; r — [[название, описание]], n — пояснение.
//              Пересылка получает только publicData: подписи и рекомендацию, без ответов о ребёнке.
//   запрос     "<действие>[:<N>]|<s>,<a>,<t>,<f>", например "t:3|2,1,03,". Состояние приходит в самом запросе,
//              поэтому бот не хранит его и переживает перезапуск. Действия: a:N возраст, t:N тема (вкл/выкл),
//              n далее, f:N формат → результат, b назад, r заново, l оставить заявку.
//   ответ      {c,p} — новое состояние (виджет рисует его сразу), {m} — сообщение, {err} — ошибка.

const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "quiz.html"), "utf8");
const UPDATE_TYPES = ["widget_query", "shared_widget_query"];
const CAPTION = "Подбор специалиста Mama Pro. Если виджет не отображается, нажмите /start.";
const FAIL = "Что-то пошло не так, попробуйте ещё раз";

function setupWidgets(bot, core) {
  // core: { startLead, logError } из бота; данные опроса — свои (quiz-data.js).
  var d = Object.assign({}, require("./quiz-data"), core);
  var labels = {
    a: d.AGES.map(function (x) { return x.label; }),
    t: d.TOPICS.map(function (x) { return x.label; }),
    f: d.FORMATS.map(function (x) { return x.label; })
  };

  function log(text) { console.log("[widget] " + text); }

  function fresh() { return { s: 1, a: null, t: [], f: null }; }

  // "s,a,t,f" → состояние или null, если строка не наша.
  function parseState(str) {
    var m = /^([1-4]),(\d?),(\d{0,9}),(\d?)$/.exec(str || "");
    if (!m) return null;
    var q = { s: Number(m[1]), a: m[2] === "" ? null : Number(m[2]), t: [], f: m[4] === "" ? null : Number(m[4]) };
    for (var i = 0; i < m[3].length; i++) {
      var ti = Number(m[3][i]);
      if (!d.TOPICS[ti] || q.t.indexOf(ti) !== -1) return null;
      q.t.push(ti);
    }
    if (q.a !== null && !d.AGES[q.a]) return null;
    if (q.f !== null && !d.FORMATS[q.f]) return null;
    return normalize(q);
  }

  // Шаг не может опережать ответы.
  function normalize(q) {
    if (q.a === null) q.s = 1;
    else if (!q.t.length) q.s = Math.min(q.s, 2);
    else if (q.f === null) q.s = Math.min(q.s, 3);
    q.t.sort(function (x, y) { return x - y; });
    return q;
  }

  function complete(q) { return q.a !== null && q.t.length > 0 && q.f !== null; }

  // Возвращает новое состояние или строку-ошибку.
  function apply(act, n, q) {
    switch (act) {
      case "a":
        if (!d.AGES[n]) return "Нет такого варианта";
        q.a = n; q.s = 2; return q;
      case "t":
        if (!d.TOPICS[n] || q.a === null) return "Нет такого варианта";
        var at = q.t.indexOf(n);
        if (at !== -1) q.t.splice(at, 1);
        else if (n === d.DONT_KNOW) q.t = [n]; // «Не знаю» исключает остальные, как в обычном опросе
        else q.t = q.t.filter(function (x) { return x !== d.DONT_KNOW; }).concat(n);
        q.s = 2; q.f = null; return normalize(q);
      case "n":
        if (!q.t.length) return "Выберите хотя бы один вариант";
        q.s = 3; return q;
      case "f":
        if (!d.FORMATS[n] || q.a === null || !q.t.length) return "Нет такого варианта";
        q.f = n; q.s = 4; return q;
      case "b":
        q.s = Math.max(1, q.s - 1); return q;
      case "r":
        return fresh();
      default:
        return "Неизвестное действие";
    }
  }

  function publicData(q, username) {
    var p = { o: labels, u: username || "" };
    if (q && q.s === 4 && complete(q)) {
      var rec = d.recommend(q.t);
      p.r = rec.keys.map(function (k) { return [d.SPECIALISTS[k].name, d.SPECIALISTS[k].desc]; });
      p.n = q.t.indexOf(d.DONT_KNOW) !== -1
        ? "Если не знаете, с чего начать, — начните с дефектолога как с общего ориентира."
        : (rec.cut ? "Показаны два самых близких типа специалистов, остальное обсудим при подборе." : "");
    }
    return p;
  }

  function where(wq) {
    return wq.inline_message_id
      ? { inline_message_id: wq.inline_message_id }
      : { chat_id: wq.chat.id, message_id: wq.message_id };
  }

  async function editState(wq, c, p) {
    try {
      await bot.api.raw.editMessageWidgetData(Object.assign(where(wq), {
        chat_data: JSON.stringify(c),
        public_data: JSON.stringify(p)
      }));
    } catch (err) {
      if (!/not modified/i.test(String((err && err.description) || (err && err.message)))) throw err;
    }
  }

  async function onQuery(ctx, wq, shared) {
    if (shared || !wq.chat || !wq.message_id) return { err: "Этот виджет работает только в чате с ботом" };
    var m = /^([a-z])(?::(\d))?\|(.*)$/.exec(wq.data || "");
    var q = m && parseState(m[3]);
    if (!q) return { err: "Не понял запрос, начните заново: /widget" };
    var act = m[1];
    var n = m[2] === undefined ? null : Number(m[2]);
    var username = bot.botInfo && bot.botInfo.username;

    if (act === "l") {
      if (!complete(q)) return { err: "Сначала ответьте на вопросы" };
      var rec = d.recommend(q.t).keys.map(function (k) { return d.SPECIALISTS[k].name; });
      await d.startLead(ctx, wq.chat.id, { age: q.a, topics: q.t.slice(), format: q.f, rec: rec });
      return { m: "Продолжим в чате — ответьте на сообщение ниже" };
    }

    var next = apply(act, n, q);
    if (typeof next === "string") return { err: next };
    var p = publicData(next, username);
    await editState(wq, next, p); // состояние меняется в сообщении; ответ отдаём только после успешного edit
    return { c: next, p: p };
  }

  // /widget — регистрировать до общего обработчика текста, иначе он ответит «Не знаю такой команды».
  bot.command("widget", async function (ctx) {
    if (ctx.chat.type !== "private") return ctx.reply("Виджет работает в личном чате с ботом.");
    try {
      var sent = await ctx.api.raw.sendWidget({
        chat_id: ctx.chat.id,
        html: HTML,
        width: 0,
        height: 0,
        caption: CAPTION,
        chat_data: JSON.stringify(fresh()),
        public_data: JSON.stringify(publicData(null, ctx.me.username)),
        allow_queries: true
      });
      log("sendWidget ok: chat " + ctx.chat.id + ", message " + sent.message_id);
    } catch (err) {
      d.logError("sendWidget", err);
      await ctx.reply("Не получилось показать виджет. Подбор можно пройти обычным способом: /start");
    }
  });

  bot.use(async function (ctx, next) {
    var u = ctx.update;
    var wq = u.widget_query || u.shared_widget_query;
    if (!wq) return next();
    var answer;
    try {
      answer = await onQuery(ctx, wq, !u.widget_query);
    } catch (err) {
      d.logError("widget_query", err);
      answer = { err: FAIL };
    }
    log((u.widget_query ? "widget_query" : "shared_widget_query") + " " + JSON.stringify(wq.data) +
      " from " + (wq.from && wq.from.id) + " → " + JSON.stringify(answer).slice(0, 200));
    try {
      await bot.api.raw.answerWidgetQuery({ widget_query_id: wq.id, data: JSON.stringify(answer) });
    } catch (err) {
      d.logError("answerWidgetQuery", err);
    }
  });

  log("включены: /widget, обработка " + UPDATE_TYPES.join(", "));
}

module.exports = { setupWidgets: setupWidgets, UPDATE_TYPES: UPDATE_TYPES, HTML: HTML };
