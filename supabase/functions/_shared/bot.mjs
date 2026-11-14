// Логика Telegram-бота Mama Pro, общая для двух запусков:
//   прод — Supabase Edge Function (webhook): supabase/functions/telegram-bot/index.ts;
//   локально — long polling: bot/index.js.
// Без импортов: grammY и клиент Supabase передаются снаружи (у Deno и Node они подключаются по-разному).
// Состояние диалога — сессия grammY по chat.id: в проде в таблице public.bot_sessions, локально в памяти.

export const SITE_URL = "https://mama-pro-hack.vercel.app";
const GENERIC_ERROR = "Что-то пошло не так, попробуйте позже";

// ---------- Данные ----------
// Описания типов специалистов — те же, что в карточках на лендинге.
export const SPECIALISTS = {
  logoped: { name: "логопед", desc: "помогает развивать речь и коммуникацию ребёнка." },
  defect: { name: "дефектолог", desc: "занимается развитием мышления, внимания и памяти." },
  neuro: { name: "нейропсихолог", desc: "оценивает когнитивные функции и подбирает упражнения." },
  psych: { name: "психолог", desc: "поддерживает эмоционально — ребёнка и всю семью." },
  lfk: { name: "ЛФК-инструктор", desc: "развивает моторику и координацию через движение." },
  aba: { name: "АВА-терапевт", desc: "формирует навыки и поведение поэтапно, в игре." }
};

export const AGES = [
  { label: "до 3 лет", value: "до 3" },
  { label: "3–6 лет", value: "3–6" },
  { label: "7–12 лет", value: "7–12" },
  { label: "13+ лет", value: "13+" }
];

// Правила подбора: ответ -> типы специалистов по убыванию приоритета.
export const TOPICS = [
  { label: "Речь", value: "речь", rec: ["logoped"] },
  { label: "Поведение и эмоции", value: "поведение и эмоции", rec: ["psych", "aba"] },
  { label: "Обучение и внимание", value: "обучение и внимание", rec: ["neuro", "defect"] },
  { label: "Моторика", value: "моторика", rec: ["lfk"] },
  { label: "Не знаю", value: "не знаю", rec: ["defect"] }
];
export const DONT_KNOW = 4; // индекс «Не знаю» в TOPICS
const MAX_RECS = 2;

export const FORMATS = [
  { label: "Онлайн", value: "онлайн" },
  { label: "Очно", value: "очно" },
  { label: "Любой", value: "любой" }
];

const FAQ = [
  {
    q: "Как выбрать специалиста?",
    a: "Пройдите короткий опрос в боте: он подскажет, какой тип специалиста стоит рассмотреть — например, логопеда, дефектолога или психолога. Это ориентир, а не диагноз. Если сомневаетесь, обсудите запрос с лечащим врачом, а затем оставьте заявку — мы свяжемся с вами."
  },
  {
    q: "Сколько это стоит?",
    a: "Стоимость зависит от специалиста. Фиксированных тарифов пока нет — цену нужно уточнять у выбранного специалиста до записи. (пример)"
  },
  {
    q: "Как проверяются специалисты?",
    a: "(пример) Здесь появится описание: какие документы проверяются и что специалист указывает о себе сам. Сейчас это заглушка — порядок проверки будет описан позже."
  },
  {
    q: "Онлайн или очно?",
    a: "Онлайн удобно, если рядом нет подходящего специалиста или трудно ездить. Очно часто лучше для занятий с движением и моторикой. Формат можно обсудить со специалистом; в опросе можно выбрать «любой»."
  },
  {
    q: "Как хранятся мои данные?",
    a: "Имя, контакт, ответы опроса (если вы его проходили), ваш Telegram id и username сохраняются в базе заявок и используются только для связи с вами. Пока вы не отправили заявку, ответы опроса хранятся только во временном состоянии диалога. Не пишите лишних сведений о здоровье ребёнка. Сроки хранения и порядок удаления данных будут описаны позже. (пример)"
  },
  {
    q: "Что, если специалист не подошёл?",
    a: "Это нормально: подходящий специалист находится не всегда с первого раза. Оставьте заявку ещё раз и напишите, что не подошло — формат, подход или время. Мы вернёмся к подбору."
  }
];

const GREETING = "Здравствуйте! Я помощник Mama Pro 💛\n" +
  "Помогу понять, какой коррекционный специалист может подойти вашему ребёнку, отвечу на частые вопросы и приму заявку.\n\n" +
  "С чего начнём?";

export function recommend(topicIdx) {
  var score = {};
  var order = [];
  topicIdx.forEach(function (ti) {
    var list = TOPICS[ti].rec;
    list.forEach(function (key, i) {
      if (!(key in score)) { score[key] = 0; order.push(key); }
      score[key] += list.length - i;
    });
  });
  order.sort(function (a, b) { return score[b] - score[a]; });
  return { keys: order.slice(0, MAX_RECS), cut: order.length > MAX_RECS };
}

// Хранилище сессий grammY в таблице public.bot_sessions (клиент с service_role, RLS без политик).
export function supabaseSessionStorage(sb) {
  return {
    read: async function (key) {
      var res = await sb.from("bot_sessions").select("value").eq("key", key).maybeSingle();
      if (res.error) throw new Error("bot_sessions read: " + res.error.message);
      return res.data ? res.data.value : undefined;
    },
    write: async function (key, value) {
      var res = await sb.from("bot_sessions").upsert({ key: key, value: value, updated_at: new Date().toISOString() });
      if (res.error) throw new Error("bot_sessions write: " + res.error.message);
    },
    delete: async function (key) {
      var res = await sb.from("bot_sessions").delete().eq("key", key);
      if (res.error) throw new Error("bot_sessions delete: " + res.error.message);
    }
  };
}

// deps: { Bot, InlineKeyboard, session, token, botConfig?, supabase?, storage?, logError, extend? }
//   storage — хранилище сессий (по умолчанию в памяти); extend(bot, api) — подключить доп. обработчики
//   (виджет) до общего обработчика текста.
export function createBot(deps) {
  var InlineKeyboard = deps.InlineKeyboard;
  var supabase = deps.supabase || null;
  var logError = deps.logError || function (where, err) { console.error("[" + where + "] " + err); };

  function initialState() {
    return { step: null, msgId: null, consent: false, lead: {}, quiz: null };
  }

  function resetLead(s) {
    s.step = null;
    s.consent = false;
    s.lead = {};
  }

  function newQuiz() {
    return { step: 1, age: null, topics: [], format: null, city: "", rec: [], done: false };
  }

  function menuKeyboard() {
    return new InlineKeyboard()
      .text("Подобрать специалиста", "quiz:start").row()
      .text("Частые вопросы", "faq").row()
      .text("Оставить заявку", "lead:start").row()
      .url("Наш сайт", SITE_URL);
  }

  function isNotModified(err) {
    return !!(err && err.description && String(err.description).indexOf("message is not modified") !== -1);
  }

  // Показывает экран: редактирует текущее сообщение, а если нельзя — отправляет новое.
  async function render(ctx, text, keyboard) {
    var chatId = ctx.chat.id;
    var s = ctx.session;
    var extra = { reply_markup: keyboard };
    var tapped = ctx.callbackQuery && ctx.callbackQuery.message;
    if (tapped) s.msgId = tapped.message_id;

    if (s.msgId) {
      try {
        await ctx.api.editMessageText(chatId, s.msgId, text, extra);
        return;
      } catch (err) {
        if (isNotModified(err)) return;
      }
    }
    var sent = await ctx.api.sendMessage(chatId, text, extra);
    s.msgId = sent.message_id;
  }

  // Убираем ответ пользователя из чата, чтобы не засорять его (и не оставлять там контакты).
  function removeUserMessage(ctx) {
    return ctx.deleteMessage().catch(function () {});
  }

  function topicsText(q) {
    return q.topics.map(function (i) { return TOPICS[i].value; }).join("; ");
  }

  var bot = new deps.Bot(deps.token, deps.botConfig);

  bot.use(deps.session({
    initial: initialState,
    storage: deps.storage,
    getSessionKey: function (ctx) {
      var u = ctx.update;
      var chat = ctx.chat || (u.widget_query && u.widget_query.chat);
      return chat ? String(chat.id) : undefined;
    }
  }));

  // Закрываем «часики» на кнопке и сбрасываем ожидание текста: каждое нажатие кнопки начинает новый шаг.
  bot.on("callback_query:data", async function (ctx, next) {
    await ctx.answerCallbackQuery().catch(function () {});
    if (ctx.chat) ctx.session.step = null;
    await next();
  });

  // ----- Заявка: экран согласия (нужен и кнопке, и виджету) -----
  function leadIntro() {
    return {
      text: "Чтобы передать заявку, нужно ваше согласие на обработку персональных данных.\n\n" +
        "Имя и контакт используются только для связи с вами по этой заявке. " +
        "Вместе с ними сохранятся ответы опроса (если вы его проходили), ваш Telegram id и username.\n\n" +
        "Согласны?",
      kb: new InlineKeyboard().text("Согласен(на)", "lead:yes").text("Отмена", "lead:cancel")
    };
  }

  // Заявка из виджета: переносим ответы опроса в состояние диалога и начинаем заявку сообщением.
  async function startLeadFromWidget(ctx, chatId, quiz) {
    var s = ctx.session;
    resetLead(s);
    s.quiz = { step: 4, age: quiz.age, topics: quiz.topics, format: quiz.format, city: "", rec: quiz.rec, done: true };
    var intro = leadIntro();
    var sent = await ctx.api.sendMessage(chatId, intro.text, { reply_markup: intro.kb });
    s.msgId = sent.message_id;
  }

  if (deps.extend) {
    deps.extend(bot, {
      AGES: AGES, TOPICS: TOPICS, FORMATS: FORMATS, SPECIALISTS: SPECIALISTS, DONT_KNOW: DONT_KNOW,
      recommend: recommend, startLead: startLeadFromWidget, logError: logError
    });
  }

  bot.command(["start", "menu"], async function (ctx) {
    var s = ctx.session;
    resetLead(s);
    s.quiz = null;
    var sent = await ctx.reply(GREETING, { reply_markup: menuKeyboard() });
    s.msgId = sent.message_id;
  });

  bot.callbackQuery("menu", function (ctx) {
    return render(ctx, GREETING, menuKeyboard());
  });

  // ----- Частые вопросы -----
  function showFaqList(ctx) {
    var kb = new InlineKeyboard();
    FAQ.forEach(function (item, i) { kb.text(item.q, "faq:" + i).row(); });
    kb.text("В меню", "menu");
    return render(ctx, "Частые вопросы. Выберите, что интересует:", kb);
  }

  bot.callbackQuery("faq", showFaqList);

  bot.callbackQuery(/^faq:(\d+)$/, function (ctx) {
    var item = FAQ[Number(ctx.match[1])];
    if (!item) return showFaqList(ctx);
    var kb = new InlineKeyboard()
      .text("← К вопросам", "faq").row()
      .text("Оставить заявку", "lead:start").row()
      .text("В меню", "menu");
    return render(ctx, item.q + "\n\n" + item.a, kb);
  });

  // ----- Опрос -----
  async function showQuizStep(ctx) {
    var s = ctx.session;
    var q = s.quiz;
    var kb = new InlineKeyboard();
    var text;

    if (q.step === 1) {
      text = "Шаг 1 из 4\n\nСколько лет ребёнку?";
      AGES.forEach(function (a, i) {
        kb.text(a.label, "quiz:age:" + i);
        if (i % 2 === 1) kb.row();
      });
    } else if (q.step === 2) {
      text = "Шаг 2 из 4\n\nС чем нужна помощь? Выберите всё подходящее" + (q.topics.length ? " и нажмите «Далее»." : ".");
      TOPICS.forEach(function (t, i) {
        kb.text((q.topics.indexOf(i) !== -1 ? "✅ " : "") + t.label, "quiz:topic:" + i).row();
      });
      if (q.topics.length) kb.text("Далее →", "quiz:topics:done").row();
    } else if (q.step === 3) {
      text = "Шаг 3 из 4\n\nКакой формат занятий удобнее?";
      FORMATS.forEach(function (f, i) { kb.text(f.label, "quiz:format:" + i); });
      kb.row();
    } else {
      text = "Шаг 4 из 4\n\nВ каком вы городе? Напишите ответ сообщением.";
      kb.text("Пропустить", "quiz:city:skip").row();
      s.step = "city";
    }

    if (q.step > 1) kb.text("← Назад", "quiz:back");
    kb.text("В меню", "menu");
    return render(ctx, text, kb);
  }

  async function finishQuiz(ctx) {
    var s = ctx.session;
    var q = s.quiz;
    // Если состояние потерялось — начинаем опрос заново
    if (!q || q.age === null || !q.topics.length || q.format === null) {
      s.quiz = newQuiz();
      return showQuizStep(ctx);
    }

    var rec = recommend(q.topics);
    q.rec = rec.keys.map(function (k) { return SPECIALISTS[k].name; });
    q.done = true;
    s.step = null;

    var lines = ["Вам может подойти: " + q.rec.join(" или "), ""];
    rec.keys.forEach(function (k) { lines.push("• " + SPECIALISTS[k].name + " — " + SPECIALISTS[k].desc); });
    lines.push("");
    lines.push(q.topics.indexOf(DONT_KNOW) !== -1
      ? "Вы не знаете, с чего начать, — предлагаем начать с дефектолога как с общего ориентира."
      : "Подобрано по вашему запросу: " + topicsText(q) + ".");
    if (rec.cut) lines.push("Запросов несколько, поэтому показаны два самых близких типа специалистов — остальное можно обсудить при подборе.");
    lines.push("Возраст: " + AGES[q.age].value + " · формат: " + FORMATS[q.format].value + " · город: " + (q.city || "не указан"));
    lines.push("");
    lines.push("Это не медицинская рекомендация.");

    var kb = new InlineKeyboard()
      .text("Оставить заявку", "lead:start").row()
      .text("Пройти заново", "quiz:start").row()
      .text("В меню", "menu");
    return render(ctx, lines.join("\n"), kb);
  }

  // Обёртка: если опроса в состоянии нет (старая кнопка), начинаем с первого шага.
  function withQuiz(handler) {
    return function (ctx) {
      var s = ctx.session;
      if (!s.quiz) {
        s.quiz = newQuiz();
        return showQuizStep(ctx);
      }
      return handler(ctx, s, s.quiz);
    };
  }

  bot.callbackQuery("quiz:start", function (ctx) {
    ctx.session.quiz = newQuiz();
    return showQuizStep(ctx);
  });

  bot.callbackQuery(/^quiz:age:(\d+)$/, withQuiz(function (ctx, s, q) {
    var i = Number(ctx.match[1]);
    if (AGES[i]) { q.age = i; q.step = 2; }
    return showQuizStep(ctx);
  }));

  bot.callbackQuery(/^quiz:topic:(\d+)$/, withQuiz(function (ctx, s, q) {
    var i = Number(ctx.match[1]);
    if (TOPICS[i]) {
      var at = q.topics.indexOf(i);
      if (at !== -1) q.topics.splice(at, 1);
      else if (i === DONT_KNOW) q.topics = [i]; // «Не знаю» исключает остальные варианты
      else q.topics = q.topics.filter(function (t) { return t !== DONT_KNOW; }).concat(i);
      q.topics.sort(function (a, b) { return a - b; });
    }
    return showQuizStep(ctx);
  }));

  bot.callbackQuery("quiz:topics:done", withQuiz(function (ctx, s, q) {
    if (q.topics.length) q.step = 3;
    return showQuizStep(ctx);
  }));

  bot.callbackQuery(/^quiz:format:(\d+)$/, withQuiz(function (ctx, s, q) {
    var i = Number(ctx.match[1]);
    if (FORMATS[i]) { q.format = i; q.step = 4; }
    return showQuizStep(ctx);
  }));

  bot.callbackQuery("quiz:city:skip", withQuiz(function (ctx, s, q) {
    q.city = "";
    return finishQuiz(ctx);
  }));

  bot.callbackQuery("quiz:back", withQuiz(function (ctx, s, q) {
    q.step = Math.max(1, q.step - 1);
    return showQuizStep(ctx);
  }));

  // ----- Заявка -----
  var cancelKeyboard = function () { return new InlineKeyboard().text("Отмена", "lead:cancel"); };

  bot.callbackQuery("lead:start", function (ctx) {
    resetLead(ctx.session);
    var intro = leadIntro();
    return render(ctx, intro.text, intro.kb);
  });

  bot.callbackQuery("lead:yes", function (ctx) {
    var s = ctx.session;
    s.consent = true;
    s.step = "name";
    return render(ctx, "Спасибо! Как вас зовут?", cancelKeyboard());
  });

  bot.callbackQuery("lead:cancel", function (ctx) {
    resetLead(ctx.session);
    return render(ctx, "Хорошо, заявку не отправляем.\n\n" + GREETING, menuKeyboard());
  });

  function leadMessage(ctx, s) {
    var q = s.quiz;
    var parts = [];
    if (q && q.done) {
      parts.push("возраст " + AGES[q.age].value);
      parts.push("запрос: " + topicsText(q));
      parts.push("формат: " + FORMATS[q.format].value);
      parts.push("город: " + (q.city || "не указан"));
      parts.push("рекомендовано: " + q.rec.join(" или "));
    }
    parts.push("user_id " + ctx.from.id);
    parts.push("username " + (ctx.from.username ? "@" + ctx.from.username : "не указан"));
    return ("Telegram-бот: " + parts.join(", ")).slice(0, 1000); // лимит поля message в БД
  }

  async function saveLead(ctx, s) {
    if (!supabase) throw new Error("Supabase не настроен (SUPABASE_URL и ключ)");
    var res = await supabase.from("leads").insert({
      name: s.lead.name,
      contact: s.lead.contact,
      message: leadMessage(ctx, s)
    });
    if (res.error) throw new Error("Supabase insert: " + res.error.message);
  }

  // ----- Текстовые сообщения: города, имени и контакта -----
  bot.on("message:text", async function (ctx) {
    var s = ctx.session;
    var text = ctx.message.text.trim();

    if (s.step === "city" && s.quiz) {
      s.quiz.city = text.slice(0, 60);
      await removeUserMessage(ctx);
      return finishQuiz(ctx);
    }

    if (s.step === "name") {
      await removeUserMessage(ctx);
      if (!text || text.length > 100) {
        return render(ctx, "Имя должно быть от 1 до 100 символов. Как вас зовут?", cancelKeyboard());
      }
      s.lead.name = text;
      s.step = "contact";
      return render(ctx, "Приятно познакомиться, " + text + "!\nОставьте контакт для связи — телефон или Telegram (например, +7 … или @username).", cancelKeyboard());
    }

    if (s.step === "contact") {
      await removeUserMessage(ctx);
      if (text.length < 3 || text.length > 150) {
        return render(ctx, "Контакт должен быть от 3 до 150 символов. Оставьте телефон или Telegram.", cancelKeyboard());
      }
      s.lead.contact = text;
      await saveLead(ctx, s);
      resetLead(s);
      s.quiz = null;
      return render(ctx, "Спасибо, мы свяжемся с вами 💛", new InlineKeyboard().text("В меню", "menu"));
    }

    // Бот не ждёт текста: подсказываем меню (в группах молчим)
    if (ctx.chat.type !== "private") return;
    var sent = await ctx.reply(text.charAt(0) === "/" ? "Не знаю такой команды. Вот что я умею:" : "Выберите действие в меню:", {
      reply_markup: menuKeyboard()
    });
    s.msgId = sent.message_id;
  });

  // ----- Ошибки -----
  // Изменения сессии в упавшем апдейте не сохраняются: следующее сообщение начнётся с прежнего состояния.
  bot.catch(async function (err) {
    logError("bot", err.error || err);
    var ctx = err.ctx;
    try {
      if (ctx && ctx.chat) {
        await ctx.api.sendMessage(ctx.chat.id, GENERIC_ERROR, {
          reply_markup: new InlineKeyboard().text("В меню", "menu")
        });
      }
    } catch (e) {
      logError("bot.catch", e);
    }
  });

  return bot;
}
