// Логика Telegram-бота Mama Pro (сценарий родительского бота — mama.md), общая для двух запусков:
//   прод — Supabase Edge Function (webhook): supabase/functions/telegram-bot/index.ts;
//   локально — long polling: bot/index.js.
// grammY и клиент Supabase передаются снаружи (у Deno и Node они подключаются по-разному).
//
// Устройство: каждый экран — функция состояния сессии (текст + кнопки). Сессия хранит язык, анкету,
// условия поиска, избранное и текущий экран, поэтому после паузы /start открывает сохранённый шаг.
// Обращения — отдельное хранилище (в проде таблица public.bot_requests); сотрудники отвечают
// из служебного чата STAFF_CHAT_ID кнопками под карточкой обращения.
import {
  CITIES, SUPPORT_CITIES, AGES, AGE_NONE, THEMES, SECTIONS, CLASS_LANGS, FORMATS, BUDGETS, BUDGET_MAX,
  CONTACT_TIMES, PROFILES, TEXT, CHOOSE_LANG, MONTHS, WEEKDAYS, CONTACT_SLOTS, MEETING_SLOTS, CALENDAR_DAYS_AHEAD
} from "./catalog.mjs";
import { WELCOME_JPEG_B64 } from "./welcome-image.mjs";

export const SITE_URL = "https://mama-pro-hack.vercel.app";
const SESSION_VERSION = 2;

// ---------- Хранилища ----------
// Сессии grammY в таблице public.bot_sessions (клиент с service_role, RLS без политик).
export function supabaseSessionStorage(sb) {
  return {
    read: async (key) => {
      const res = await sb.from("bot_sessions").select("value").eq("key", key).maybeSingle();
      if (res.error) throw new Error("bot_sessions read: " + res.error.message);
      return res.data ? res.data.value : undefined;
    },
    write: async (key, value) => {
      const res = await sb.from("bot_sessions").upsert({ key, value, updated_at: new Date().toISOString() });
      if (res.error) throw new Error("bot_sessions write: " + res.error.message);
    },
    delete: async (key) => {
      const res = await sb.from("bot_sessions").delete().eq("key", key);
      if (res.error) throw new Error("bot_sessions delete: " + res.error.message);
    }
  };
}

export function memorySessionStorage() {
  const map = new Map();
  return {
    read: async (key) => (map.has(key) ? JSON.parse(map.get(key)) : undefined),
    write: async (key, value) => { map.set(key, JSON.stringify(value)); },
    delete: async (key) => { map.delete(key); }
  };
}

// Обращения в таблице public.bot_requests. Запись: { id, chat_id, kind, status, snapshot, proposal, answer, created_at }.
export function supabaseRequestStore(sb) {
  const check = (res, what) => { if (res.error) throw new Error("bot_requests " + what + ": " + res.error.message); return res.data; };
  return {
    create: async (row) => check(await sb.from("bot_requests").insert(row).select().single(), "insert"),
    get: async (id) => check(await sb.from("bot_requests").select("*").eq("id", id).maybeSingle(), "select"),
    list: async (chatId) => check(await sb.from("bot_requests").select("*").eq("chat_id", chatId)
      .order("created_at", { ascending: false }).limit(20), "list"),
    update: async (id, patch) => check(await sb.from("bot_requests")
      .update(Object.assign({}, patch, { updated_at: new Date().toISOString() })).eq("id", id).select().single(), "update")
  };
}

export function memoryRequestStore() {
  const rows = [];
  const copy = (r) => (r ? JSON.parse(JSON.stringify(r)) : null);
  return {
    create: async (row) => {
      const r = Object.assign({ id: globalThis.crypto.randomUUID(), status: "accepted", proposal: null, answer: null,
        created_at: new Date().toISOString() }, row);
      rows.push(r);
      return copy(r);
    },
    get: async (id) => copy(rows.find((r) => r.id === id)),
    list: async (chatId) => rows.filter((r) => r.chat_id === chatId).reverse().slice(0, 20).map(copy),
    update: async (id, patch) => {
      const r = rows.find((x) => x.id === id);
      if (!r) throw new Error("bot_requests update: not found");
      Object.assign(r, patch);
      return copy(r);
    }
  };
}

// ---------- Специалисты ----------
// Строка public.specialists → профиль бота: dir — "раздел:пункт" по specialty_code, ages — индексы AGES.
export function profileFromRow(row) {
  let dir = null;
  SECTIONS.forEach((sec, si) => sec.dirs.forEach((d, di) => { if (d.code === row.specialty_code) dir = si + ":" + di; }));
  if (!dir) return null;
  const ages = (row.age_bands || []).map((c) => AGES.findIndex((a) => a.code === c)).filter((i) => i >= 0);
  return {
    id: row.id, name: row.display_name, dir, city: row.city || null,
    formats: row.formats || [], langs: row.languages || [], ages,
    price: row.price_kzt === null || row.price_kzt === undefined ? null : row.price_kzt,
    minutes: row.duration_min || null,
    availability: row.availability || "unknown",
    exp: row.experience_years || null,
    about: row.about && row.about.ru ? row.about : null,
    quals: Array.isArray(row.qualifications) ? row.qualifications : []
  };
}

// Загрузка демо-профилей из БД (чтение открыто: данные вымышленные).
export function supabaseSpecialistSource(sb) {
  return async () => {
    const res = await sb.from("specialists").select("*").eq("is_demo", true);
    if (res.error) throw new Error("specialists select: " + res.error.message);
    return (res.data || []).map(profileFromRow).filter(Boolean)
      .sort((a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")) || a.id.localeCompare(b.id));
  };
}

// Подходит ли профиль под анкету и условия поиска сессии (s.p, s.q). Экспорт — для проверки покрытия демо-данных.
export function matchesProfile(pr, s) {
  const p = s.p, q = s.q;
  if (pr.dir !== q.dir) return false;
  if (p.age !== null && p.age !== AGE_NONE && pr.ages.indexOf(p.age) === -1) return false;
  const cl = CLASS_LANGS[q.clang];
  if (!cl || (cl.id !== "any" && pr.langs.indexOf(cl.id) === -1)) return false;
  const f = FORMATS[q.fmt];
  const offlineOk = pr.formats.indexOf("off") !== -1 && !!(p.city && p.city.id === pr.city);
  const onlineOk = pr.formats.indexOf("on") !== -1;
  if (!f || (f.id === "off" && !offlineOk) || (f.id === "on" && !onlineOk) || (f.id === "any" && !offlineOk && !onlineOk)) return false;
  if (q.budget === null) return false;
  // Неизвестная цена (null) не проходит фильтр с ограничением бюджета — «не указано» не значит «дёшево».
  if (q.budget >= 0 && (pr.price === null || pr.price > q.budget)) return false;
  return true;
}

// ---------- Даты и календарь ----------
// Всё время — Алматы: единое время Казахстана UTC+5. Дата хранится как "YYYY-MM-DD", в кнопках — "YYYYMMDD".
const KZ_OFFSET_MS = 5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
function kzToday() {
  const d = new Date(Date.now() + KZ_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const compactDate = (ms) => isoDate(ms).replace(/-/g, "");
const monthKey = (ms) => compactDate(ms).slice(0, 6);
function parseDate(str) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(str || ""));
  if (!m) return NaN;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return isoDate(ms) === m[1] + "-" + m[2] + "-" + m[3] ? ms : NaN;
}
// Выбирать можно с завтрашнего дня на CALENDAR_DAYS_AHEAD дней вперёд.
function calendarRange() {
  const today = kzToday();
  return { min: today + DAY_MS, max: today + CALENDAR_DAYS_AHEAD * DAY_MS };
}
const inCalendar = (ms) => { const r = calendarRange(); return ms >= r.min && ms <= r.max; };
function shiftMonth(key, delta) {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1 + delta, 1));
  return monthKey(d.getTime());
}
// Месяц в допустимом диапазоне (иначе — первый допустимый).
function clampMonth(key) {
  const r = calendarRange();
  const lo = monthKey(r.min), hi = monthKey(r.max);
  return /^\d{6}$/.test(String(key || "")) && key >= lo && key <= hi ? key : lo;
}
// "16 ноября (пн)" / "16 қараша (дс)".
function dayLabel(lang, ms) {
  const d = new Date(ms);
  const wd = WEEKDAYS[lang][(d.getUTCDay() + 6) % 7].toLowerCase();
  return d.getUTCDate() + " " + MONTHS[lang].gen[d.getUTCMonth()] + " (" + wd + ")";
}

// Сетка месяца в inline-клавиатуре: стрелки месяцев, дни недели, числа. dayCb(YYYYMMDD) / navCb(YYYYMM) — callback_data.
export function addCalendar(k, lang, key, dayCb, navCb) {
  const r = calendarRange();
  const ym = clampMonth(key);
  const y = +ym.slice(0, 4), m = +ym.slice(4, 6) - 1;
  const lo = monthKey(r.min), hi = monthKey(r.max);
  const prev = shiftMonth(ym, -1), next = shiftMonth(ym, 1);
  k.text(ym > lo ? "‹" : " ", ym > lo ? navCb(prev) : "noop")
    .text(MONTHS[lang].nom[m] + " " + y, "noop")
    .text(ym < hi ? "›" : " ", ym < hi ? navCb(next) : "noop").row();
  WEEKDAYS[lang].forEach((w) => k.text(w, "noop"));
  k.row();
  const cells = [];
  const pad = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  for (let i = 0; i < pad; i++) cells.push([" ", "noop"]);
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (let d = 1; d <= days; d++) {
    const ms = Date.UTC(y, m, d);
    cells.push(ms >= r.min && ms <= r.max ? [String(d), dayCb(compactDate(ms))] : ["·", "noop"]);
  }
  while (cells.length % 7) cells.push([" ", "noop"]);
  cells.forEach((c, i) => { k.text(c[0], c[1]); if (i % 7 === 6) k.row(); });
  return k;
}

// ---------- Вспомогательное ----------
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const NBSP = " ";
export const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) + NBSP + "₸";
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u;

function initialState() {
  return {
    v: SESSION_VERSION,
    lang: null,
    screen: "lang",
    msgId: null,
    ret: null, // экран, куда вернуться после редактирования поля (сводка, условия, настройки)
    notify: true,
    p: { city: null, first: "", last: "", phone: "", age: null, topic: null, time: null },
    q: { dir: null, clang: null, fmt: null, budget: null, idx: 0, fav: [], cmp: [] },
    ui: { theme: null, sec: null, spec: null, req: null, info: false, err: null, flash: null,
      pendingFirst: null, tmpBudget: null, prev: null, retry: null },
    staff: null // ожидание ответа сотрудника (только в служебном чате)
  };
}

// Картинка приветствия: байты декодируются один раз; после первой отправки Telegram отдаёт file_id,
// и дальше картинка не загружается заново (кэш на время жизни процесса).
let welcomeBytes = null;
let welcomeFileId = null;
function welcomeImage() {
  if (!welcomeBytes) welcomeBytes = Uint8Array.from(atob(WELCOME_JPEG_B64), (c) => c.charCodeAt(0));
  return welcomeBytes;
}

// deps: { Bot, InlineKeyboard, InputFile?, session, token, loadSpecialists?, botConfig?, supabase?, storage?, requests?, staffChatId?, logError, extend? }
export function createBot(deps) {
  const InlineKeyboard = deps.InlineKeyboard;
  const supabase = deps.supabase || null;
  const storage = deps.storage || memorySessionStorage();
  const requests = deps.requests || memoryRequestStore();
  const staffChatId = deps.staffChatId ? String(deps.staffChatId) : "";
  const logError = deps.logError || ((where, err) => console.error("[" + where + "] " + err));

  // Профили специалистов: из БД (deps.loadSpecialists) с кэшем на минуту; без БД или при ошибке — запасной набор.
  const SPEC_TTL_MS = 60 * 1000;
  let specList = PROFILES;
  let specAt = 0;
  async function refreshSpecialists() {
    if (!deps.loadSpecialists || Date.now() - specAt < SPEC_TTL_MS) return;
    specAt = Date.now();
    try {
      const list = await deps.loadSpecialists();
      if (list.length) specList = list;
    } catch (err) {
      logError("specialists", err);
    }
  }

  // ---------- Тексты ----------
  const L = (s) => (s && s.lang === "kk" ? "kk" : "ru");
  const t = (s, key, vars) => {
    const str = TEXT[L(s)][key] ?? TEXT.ru[key] ?? key;
    return vars ? str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? esc(vars[k]) : m)) : str;
  };
  const lbl = (s, obj) => obj[L(s)];

  const cityLabel = (s, c) => (!c ? t(s, "notSet") : c.id ? lbl(s, CITIES.find((x) => x.id === c.id) || { ru: c.id, kk: c.id }) : c.name);
  const ageLabel = (s, a) => (a === null || a === undefined || a === AGE_NONE ? t(s, "notSet") : lbl(s, AGES[a]));
  const topicOf = (key) => {
    if (typeof key !== "string") return null;
    const [ti, ii] = key.split(":").map(Number);
    return THEMES[ti] && THEMES[ti].items[ii] ? { theme: THEMES[ti], item: THEMES[ti].items[ii] } : null;
  };
  const topicLabel = (s, key) => { const x = topicOf(key); return x ? lbl(s, x.item) : t(s, "notSet"); };
  const dirOf = (key) => {
    if (typeof key !== "string") return null;
    const [si, di] = key.split(":").map(Number);
    return SECTIONS[si] && SECTIONS[si].dirs[di] ? { sec: si, dir: SECTIONS[si].dirs[di] } : null;
  };
  const dirLabel = (s, key) => { const x = dirOf(key); return x ? lbl(s, x.dir) : t(s, "notSet"); };
  const budgetLabel = (s, b) => (b === null || b === undefined ? t(s, "notSet")
    : b < 0 ? t(s, "budgetNone") : b === 0 ? t(s, "budgetFree") : t(s, "budgetUpTo", { sum: money(b) }));
  const fullName = (p) => (p.first + " " + p.last).trim();
  const priceLabel = (s, pr) => {
    if (pr.price === null || pr.price === undefined) return t(s, "priceUnknown");
    const price = pr.price === 0 ? t(s, "free") : money(pr.price);
    return pr.minutes ? t(s, "priceFmt", { price, min: pr.minutes }) : esc(price);
  };
  const profile = (id) => specList.find((x) => x.id === id) || null;
  const canRequest = (pr) => pr.availability === "available";
  // Годы опыта: по-русски склоняем (1 год, 3 года, 5 лет), по-казахски «жыл» не меняется.
  const yearsRu = (n) => n + " " + (n % 10 === 1 && n % 100 !== 11 ? "год"
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "года" : "лет");
  const expLabel = (s, n) => t(s, "lExp", { n: L(s) === "kk" ? n : yearsRu(n) });
  const statusLabel = (s, st) => t(s, "st_" + st);
  // Удобное время для связи: { date: "YYYY-MM-DD", time: "11:00" | null } (null — любое время этого дня).
  // Старые сессии хранили индекс CONTACT_TIMES — показываем его прежней подписью.
  const whenLabel = (s, date, time) => {
    const ms = parseDate(date);
    if (isNaN(ms)) return t(s, "notSet");
    const day = dayLabel(L(s), ms);
    return time ? TEXT[L(s)].whenAt.replace("{date}", day).replace("{time}", time) : TEXT[L(s)].whenAny.replace("{date}", day);
  };
  const timeLabel = (s, v) => (v && typeof v === "object" ? whenLabel(s, v.date, v.time)
    : typeof v === "number" && CONTACT_TIMES[v] ? lbl(s, CONTACT_TIMES[v]) : t(s, "notSet"));
  const timeValid = (v) => !!(v && typeof v === "object" && inCalendar(parseDate(v.date)) &&
    (v.time === null || CONTACT_SLOTS.indexOf(v.time) !== -1));
  // Предложение сотрудника: из календаря — "YYYY-MM-DD HH:MM" (показываем на языке родителя), иначе — как написал сотрудник.
  const proposalLabel = (s, v) => {
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(String(v || ""));
    return m ? whenLabel(s, m[1], m[2]) : String(v || "");
  };
  const dateLabel = (iso) => { const d = String(iso || "").slice(0, 10).split("-"); return d.length === 3 ? d[2] + "." + d[1] + "." + d[0] : ""; };

  // ---------- Подбор ----------
  const matches = matchesProfile;
  // Сначала те, кто принимает новые обращения; порядок внутри групп — как в БД.
  const results = (s) => {
    const list = specList.filter((pr) => matches(pr, s));
    return list.filter(canRequest).concat(list.filter((pr) => !canRequest(pr)));
  };
  // Первый незаполненный параметр поиска (экран), либо null.
  const missingCondition = (s) => (!dirOf(s.q.dir) ? "sections" : s.q.clang === null ? "clang"
    : s.q.fmt === null ? "fmt" : s.q.budget === null ? "budget" : null);
  // Первое незаполненное обязательное поле обращения (экран), либо null.
  const missingRequired = (s) => (!s.p.first || !s.p.last ? "name" : !s.p.phone ? "phone" : !topicOf(s.p.topic) ? "themes" : null);

  function cardLines(s, pr) {
    const fm = pr.formats.map((f) => t(s, f === "off" ? "fmtOff" : "fmtOn")).join(", ");
    const lg = pr.langs.map((x) => t(s, x === "kk" ? "langKk" : "langRu")).join(", ");
    return [
      "<b>" + esc(pr.name) + "</b> — " + esc(dirLabel(s, pr.dir)),
      // Город только у тех, у кого он есть (работающие только онлайн его не указывают).
      ...(pr.city ? [t(s, "lCity") + ": " + esc(cityLabel(s, { id: pr.city }))] : []),
      t(s, "lFormat") + ": " + esc(fm),
      t(s, "lLangs") + ": " + esc(lg),
      t(s, "lAges") + ": " + esc(pr.ages.map((a) => lbl(s, AGES[a])).join(", ")),
      t(s, "lPrice") + ": " + priceLabel(s, pr),
      t(s, pr.availability === "available" ? "newOk" : pr.availability === "waitlist" ? "newNo" : "newUnknown")
    ];
  }

  // ---------- Отрисовка ----------
  function isNotModified(err) {
    return !!(err && err.description && String(err.description).indexOf("message is not modified") !== -1);
  }

  // Показывает экран: редактирует текущее сообщение бота, а если нельзя — отправляет новое.
  async function render(ctx, chatId, text, kb) {
    const s = ctx.session;
    const extra = { reply_markup: kb, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
    const tapped = ctx.callbackQuery && ctx.callbackQuery.message;
    // Сообщение с картинкой (приветствие) текстом не редактируем — экран уходит новым сообщением ниже.
    if (tapped && !tapped.photo) s.msgId = tapped.message_id;
    if (s.msgId) {
      try {
        await ctx.api.editMessageText(chatId, s.msgId, text, extra);
        return;
      } catch (err) {
        if (isNotModified(err)) return;
      }
    }
    const sent = await ctx.api.sendMessage(chatId, text, extra);
    s.msgId = sent.message_id;
  }

  const kb = () => new InlineKeyboard();
  const backTo = (s, def) => "go:" + (s.ret || def);
  // Кнопки по три в ряд.
  function pairs3(k, items) {
    items.forEach((it, i) => { k.text(it[0], it[1]); if (i % 3 === 2) k.row(); });
    if (items.length % 3) k.row();
    return k;
  }

  // Кнопки по две в ряд.
  function pairs(k, items) {
    items.forEach((it, i) => { k.text(it[0], it[1]); if (i % 2 === 1) k.row(); });
    if (items.length % 2 === 1) k.row();
    return k;
  }

  async function show(ctx, name, chatIdOverride) {
    const s = ctx.session;
    if (!s.lang) name = "lang";
    let fn = SCREENS[name];
    if (!fn) { name = "menu"; fn = SCREENS.menu; }
    const view = await fn(s, ctx);
    if (view.redirect) return show(ctx, view.redirect, chatIdOverride);
    s.screen = name;
    let text = view.text;
    if (s.ui.flash) text = s.ui.flash + "\n\n" + text;
    if (s.ui.err) text += "\n\n⚠️ " + s.ui.err;
    s.ui.flash = null;
    s.ui.err = null;
    const chatId = chatIdOverride || (ctx.chat && ctx.chat.id);
    return render(ctx, chatId, text, view.kb);
  }

  // После ответа на вопрос: вернуться в сводку/настройки, если поле редактировали оттуда, иначе — дальше по сценарию.
  function advance(ctx, def) {
    const s = ctx.session;
    const r = s.ret;
    s.ret = null;
    return show(ctx, r || def);
  }

  // ---------- Экраны ----------
  const SCREENS = {
    lang: () => ({
      text: CHOOSE_LANG,
      kb: kb().text("Қазақша", "lang:kk").text("Русский", "lang:ru")
    }),

    city: (s) => {
      const k = kb();
      CITIES.forEach((c, i) => k.text(lbl(s, c), "city:" + i).row());
      k.text(t(s, "cityOther"), "city:other");
      if (s.ret) k.row().text(t(s, "btnBack"), "go:" + s.ret); // первый шаг анкеты: назад — только при редактировании
      return { text: t(s, "cityQ"), kb: k };
    },

    cityOther: (s) => ({ text: t(s, "cityOtherQ"), kb: kb().text(t(s, "btnBack"), "go:city") }),

    cityOnline: (s) => ({
      text: "<b>" + esc(cityLabel(s, s.p.city)) + "</b>\n" + t(s, "cityOnline"),
      kb: kb().text(t(s, "btnContinueIntro"), "city:ok").row().text(t(s, "btnChangeCity"), "go:city")
    }),

    name: (s) => {
      let text = t(s, "nameQ");
      if (s.ui.pendingFirst) text += "\n\n" + t(s, "nameGot", { first: s.ui.pendingFirst });
      return { text, kb: kb().text(t(s, "btnBack"), backTo(s, "city")) };
    },

    phone: (s) => ({ text: t(s, "phoneQ"), kb: kb().text(t(s, "btnBack"), backTo(s, "name")) }),

    age: (s) => {
      const k = pairs(kb(), AGES.map((a, i) => [lbl(s, a), "age:" + i]));
      k.text(t(s, "btnBack"), backTo(s, "phone"));
      return { text: t(s, "ageQ"), kb: k };
    },

    themes: (s) => {
      const k = kb();
      THEMES.forEach((th, i) => k.text(lbl(s, th), "theme:" + i).row());
      k.text(t(s, "btnBack"), backTo(s, "age"));
      return { text: t(s, "themesQ"), kb: k };
    },

    topics: (s) => {
      const th = THEMES[s.ui.theme];
      if (!th) return { redirect: "themes" };
      const k = kb();
      th.items.forEach((it, i) => k.text(lbl(s, it), "topic:" + i).row());
      k.text(t(s, "btnOtherThemes"), "go:themes");
      return { text: t(s, "topicQ", { theme: lbl(s, th) }), kb: k };
    },

    next: (s) => ({
      text: t(s, "nextQ", { name: s.p.first || "" }).replace(", .", "."),
      kb: kb().text(t(s, "btnSupport"), "go:supportIntro").row()
        .text(t(s, "btnSearchNow"), "go:sections").row()
        .text(t(s, "btnMenu"), "go:menu")
    }),

    supportIntro: (s) => {
      const ok = !!(s.p.city && s.p.city.id && SUPPORT_CITIES.indexOf(s.p.city.id) !== -1);
      if (!ok) {
        return {
          text: t(s, "supportNoCity"),
          kb: kb().text(t(s, "btnGoSearch"), "go:sections").row()
            .text(t(s, "btnOtherCity"), "ed:city").row()
            .text(t(s, "btnMenu"), "go:menu")
        };
      }
      return {
        text: t(s, "supportIntro"),
        kb: kb().text(t(s, "btnRequestConsult"), "go:time").row()
          .text(t(s, "btnGoSearch"), "go:sections").row()
          .text(t(s, "btnMenu"), "go:menu")
      };
    },

    // Удобный день для связи — календарь.
    time: (s) => {
      s.ui.calMonth = clampMonth(s.ui.calMonth);
      const k = addCalendar(kb(), L(s), s.ui.calMonth, (d) => "cal:d:" + d, (m) => "cal:m:" + m);
      k.text(t(s, "btnBack"), backTo(s, "supportIntro"));
      return { text: t(s, "timeQ"), kb: k };
    },

    // Время в выбранный день.
    timeSlot: (s) => {
      const ms = parseDate(s.ui.calDate);
      if (!inCalendar(ms)) return { redirect: "time" };
      const k = pairs3(kb(), CONTACT_SLOTS.map((h) => [h, "slot:" + h.replace(":", "")]));
      k.text(t(s, "btnAnyTime"), "slot:any").row();
      k.text(t(s, "btnOtherDay"), "cal:m:" + monthKey(ms));
      return { text: t(s, "slotQ", { date: dayLabel(L(s), ms) }), kb: k };
    },

    reviewSupport: (s) => {
      const lines = [t(s, "reviewSupport"), ""].concat(supportLines(s).map(([k, v]) => k + ": <b>" + esc(v) + "</b>"));
      lines.push("", "<i>" + t(s, "consentNote") + "</i>");
      const k = kb().text(t(s, "btnSend"), "send:support").row();
      pairs(k, [
        [t(s, "btnEdName"), "ed:name"], [t(s, "btnEdPhone"), "ed:phone"], [t(s, "btnEdCity"), "ed:city"],
        [t(s, "btnEdAge"), "ed:age"], [t(s, "btnEdTopic"), "ed:themes"], [t(s, "btnEdTime"), "ed:time"]
      ]);
      k.text(t(s, "btnMenu"), "go:menu");
      return { text: lines.join("\n"), kb: k };
    },

    supportAccepted: (s) => ({
      text: t(s, "supportAccepted"),
      kb: kb().text(t(s, "btnOpenReq"), "rq:" + s.ui.req).row()
        .text(t(s, "btnContinueSearch"), "search:cont").row()
        .text(t(s, "btnMainMenu"), "go:menu")
    }),

    sections: (s) => {
      const k = kb();
      SECTIONS.forEach((sec, i) => k.text(lbl(s, sec), "sec:" + i).row());
      k.text(t(s, "btnDontKnow"), "go:unknown").row();
      if (s.ret) k.text(t(s, "btnBack"), "go:" + s.ret);
      else k.text(t(s, "btnMenu"), "go:menu");
      return { text: t(s, "sectionsQ"), kb: k };
    },

    unknown: (s) => {
      const lines = [t(s, "unknownIntro"), ""];
      const k = kb();
      SECTIONS.forEach((sec, i) => {
        lines.push("<b>" + esc(lbl(s, sec)) + "</b> — " + esc(lbl(s, sec.desc)));
        k.text(lbl(s, sec), "sec:" + i).row();
      });
      k.text(t(s, "btnSupportSelf"), "go:supportIntro").row();
      k.text(t(s, "btnBack"), "go:sections");
      return { text: lines.join("\n"), kb: k };
    },

    dirs: (s) => {
      const sec = SECTIONS[s.ui.sec];
      if (!sec) return { redirect: "sections" };
      const k = kb();
      sec.dirs.forEach((d, i) => k.text(lbl(s, d), "dir:" + i).row());
      k.text(t(s, "btnAllSections"), "go:sections");
      return { text: t(s, "dirsQ", { section: lbl(s, sec) }), kb: k };
    },

    clang: (s) => {
      const k = kb();
      CLASS_LANGS.forEach((c, i) => k.text(lbl(s, c), "clang:" + i).row());
      k.text(t(s, "btnBack"), backTo(s, "dirs"));
      return { text: t(s, "classLangQ"), kb: k };
    },

    fmt: (s) => {
      const k = kb();
      FORMATS.forEach((f, i) => k.text(lbl(s, f), "fmt:" + i).row());
      k.text(t(s, "btnBack"), backTo(s, "clang"));
      return { text: t(s, "formatQ"), kb: k };
    },

    budget: (s) => {
      const k = pairs(kb(), BUDGETS.map((b, i) => [budgetLabel(s, b), "bud:" + i]));
      if (s.ui.tmpBudget !== null && s.ui.tmpBudget !== undefined) {
        k.text(t(s, "btnUseSum", { sum: money(s.ui.tmpBudget) }), "bud:custom").row();
      }
      k.text(t(s, "btnBack"), backTo(s, "fmt"));
      return { text: t(s, "budgetQ"), kb: k };
    },

    conditions: (s) => {
      const lines = [t(s, "conditionsQ"), ""].concat(conditionLines(s).map(([k, v]) => k + ": <b>" + esc(v) + "</b>"));
      const k = kb().text(t(s, "btnShow"), "res:show").row();
      pairs(k, [
        [t(s, "btnEdDir"), "ed:sections"], [t(s, "btnEdAge"), "ed:age"], [t(s, "btnEdCity"), "ed:city"],
        [t(s, "btnEdClassLang"), "ed:clang"], [t(s, "btnEdFormat"), "ed:fmt"], [t(s, "btnEdBudget"), "ed:budget"]
      ]);
      k.text(t(s, "btnMenu"), "go:menu");
      return { text: lines.join("\n"), kb: k };
    },

    results: (s) => {
      const miss = missingCondition(s);
      if (miss) return { redirect: miss === "sections" ? "sections" : "conditions" };
      const list = results(s);
      if (!list.length) {
        const inDir = specList.some((pr) => pr.dir === s.q.dir);
        const k = kb().text(t(s, "btnOtherDirs"), "go:sections").row()
          .text(t(s, "btnChangeCond"), "go:conditions").row();
        if (inDir && FORMATS[s.q.fmt].id !== "on") k.text(t(s, "btnSeeOnline"), "fmt:online").row();
        k.text(t(s, "btnAboutSupport"), "go:supportIntro").row().text(t(s, "btnMenu"), "go:menu");
        return { text: t(s, inDir ? "noMatch" : "noProfiles"), kb: k };
      }
      const i = Math.min(Math.max(0, s.q.idx), list.length - 1);
      s.q.idx = i;
      const pr = list[i];
      const text = [t(s, "resultsTitle", { i: i + 1, n: list.length }), ""].concat(cardLines(s, pr))
        .concat(["", "<i>" + t(s, "demoMark") + "</i>"]).join("\n");
      const k = kb().text(t(s, "btnMore"), "card:" + pr.id).row();
      k.text(t(s, s.q.fav.indexOf(pr.id) !== -1 ? "btnUnfav" : "btnFav"), "fav:" + pr.id)
        .text(t(s, s.q.cmp.indexOf(pr.id) !== -1 ? "btnUncmp" : "btnCmp"), "cmp:" + pr.id).row();
      if (i > 0) k.text("‹ " + t(s, "btnPrev"), "res:" + (i - 1));
      if (i < list.length - 1) k.text(t(s, "btnNext") + " ›", "res:" + (i + 1));
      if (list.length > 1) k.row();
      if (s.q.cmp.length) k.text(t(s, "btnCompareN", { n: s.q.cmp.length }), "go:compare").row();
      k.text(t(s, "btnChangeCond"), "go:conditions").text(t(s, "btnMenu"), "go:menu");
      return { text, kb: k };
    },

    profile: (s) => {
      const pr = profile(s.ui.spec);
      if (!pr) return { redirect: "results" };
      const lines = [t(s, "profileTitle"), ""].concat(cardLines(s, pr));
      if (pr.about) lines.push("", esc(lbl(s, pr.about)));
      if (pr.exp) lines.push("", expLabel(s, pr.exp));
      if (pr.quals && pr.quals.length) {
        lines.push(t(s, "lQual") + ":");
        pr.quals.forEach((qu) => lines.push("• " + esc(qu.title ? lbl(s, qu.title) || qu.title.ru : "")));
      }
      lines.push("", "<i>" + t(s, "demoMark") + "</i>");
      const text = lines.join("\n");
      const k = kb();
      if (canRequest(pr)) k.text(t(s, "btnPrepare"), "prep:" + pr.id).row();
      k.text(t(s, s.q.fav.indexOf(pr.id) !== -1 ? "btnUnfav" : "btnFav"), "fav:" + pr.id)
        .text(t(s, s.q.cmp.indexOf(pr.id) !== -1 ? "btnUncmp" : "btnCmp"), "cmp:" + pr.id).row();
      if (s.q.cmp.length) k.text(t(s, "btnOpenCmp"), "go:compare").row();
      k.text(t(s, "btnToResults"), "go:results").text(t(s, "btnMenu"), "go:menu");
      return { text, kb: k };
    },

    compare: (s) => {
      const list = s.q.cmp.map(profile).filter(Boolean);
      const lines = [t(s, "cmpTitle"), ""];
      const k = kb();
      list.forEach((pr) => {
        lines.push("<b>" + esc(pr.name) + "</b> — " + esc(dirLabel(s, pr.dir)));
        lines.push(t(s, "lPrice") + ": " + priceLabel(s, pr));
        lines.push(t(s, "lFormat") + ": " + esc(pr.formats.map((f) => t(s, f === "off" ? "fmtOff" : "fmtOn")).join(", ")));
        lines.push(t(s, "lLangs") + ": " + esc(pr.langs.map((x) => t(s, x === "kk" ? "langKk" : "langRu")).join(", ")));
        if (pr.city) lines.push(t(s, "lCity") + ": " + esc(cityLabel(s, { id: pr.city })));
        lines.push(t(s, "lAges") + ": " + esc(pr.ages.map((a) => lbl(s, AGES[a])).join(", ")));
        lines.push("");
        k.text(t(s, "btnPick", { name: pr.name }), "card:" + pr.id).text(t(s, "btnRemove", { name: pr.name }), "cmpx:" + pr.id).row();
      });
      if (list.length < 2) lines.push(t(s, "cmpOne"));
      lines.push("<i>" + t(s, "demoMark") + "</i>");
      k.text(t(s, "btnBackResults"), "go:results");
      return { text: lines.join("\n"), kb: k };
    },

    reviewSpec: (s) => {
      const pr = profile(s.ui.spec);
      if (!pr) return { redirect: "results" };
      const lines = [t(s, "reviewSpec"), ""].concat(specLines(s, pr).slice(0, -1).map(([k, v]) => k + ": <b>" + esc(v) + "</b>"));
      lines.push("", t(s, "specPriceNote", { price: "" }) + priceLabel(s, pr));
      lines.push("", "<i>" + t(s, "consentNote") + "</i>");
      const k = kb().text(t(s, "btnSend"), "send:spec").row()
        .text(t(s, "btnEdName"), "ed:name").text(t(s, "btnEdPhone2"), "ed:phone").row()
        .text(t(s, "btnEdSearch"), "go:conditions").row()
        .text(t(s, "btnBackSpec"), "card:" + pr.id);
      return { text: lines.join("\n"), kb: k };
    },

    specMismatch: (s) => ({
      text: t(s, "specMismatch"),
      kb: kb().text(t(s, "btnToConditions"), "go:conditions").row().text(t(s, "btnOtherSpec"), "go:results")
    }),

    specAccepted: (s) => ({
      text: t(s, "specAccepted"),
      kb: kb().text(t(s, "btnOpenReq"), "rq:" + s.ui.req).row()
        .text(t(s, "btnContinueSearch"), "search:cont").row()
        .text(t(s, "btnMainMenu"), "go:menu")
    }),

    sendFail: (s) => ({
      text: t(s, "sendFail"),
      kb: kb().text(t(s, "btnRetry"), "send:" + (s.ui.retry || "support"))
        .text(t(s, "btnReturn"), s.ui.retry === "spec" ? "go:reviewSpec" : "go:reviewSupport")
    }),

    reqs: async (s, ctx) => {
      const list = await requests.list(ctx.chat.id);
      const k = kb();
      if (!list.length) {
        k.text(t(s, "btnChooseNext"), "go:next").row().text(t(s, "btnMenu"), "go:menu");
        return { text: t(s, "myReqsTitle") + "\n\n" + t(s, "myReqsEmpty"), kb: k };
      }
      list.slice(0, 10).forEach((r) => {
        const label = reqLabel(s, r) + " — " + statusLabel(s, r.status);
        k.text(label.length > 60 ? label.slice(0, 59) + "…" : label, "rq:" + r.id).row();
      });
      k.text(t(s, "btnMenu"), "go:menu");
      return { text: t(s, "myReqsTitle"), kb: k };
    },

    req: async (s, ctx) => {
      const r = await ownRequest(ctx, s.ui.req);
      if (!r) return { redirect: "reqs" };
      const lines = ["<b>" + esc(reqLabel(s, r)) + "</b>", t(s, "reqRecipient"),
        t(s, "reqStatus", { status: statusLabel(s, r.status) }), t(s, "reqSent", { date: dateLabel(r.created_at) })];
      if (r.status === "proposed" && r.proposal) lines.push("", t(s, "reqProposal", { when: proposalLabel(s, r.proposal) }));
      if (r.status === "confirmed" && r.proposal) lines.push("", t(s, "reqMeeting", { when: proposalLabel(s, r.proposal) }));
      if (r.status === "answered") lines.push("", r.answer ? t(s, "answerOther", { text: r.answer }) : t(s, "specReady"));
      if (s.ui.info) {
        lines.push("", "<i>" + t(s, "infoNote") + "</i>");
        (r.snapshot.lines || []).forEach(([k, v]) => lines.push(esc(k) + ": " + esc(v)));
      }
      const k = kb().text(t(s, s.ui.info ? "btnHideInfo" : "btnShowInfo"), "rqi:" + r.id).row();
      if (r.status === "proposed") k.text(t(s, "btnFits"), "rqok:" + r.id).text(t(s, "btnOtherTime"), "rqno:" + r.id).row();
      if (r.status !== "cancelled") k.text(t(s, "btnCancelReq"), "rqc:" + r.id).row();
      k.text(t(s, "btnMyReqs"), "go:reqs").text(t(s, "btnSearchSpecs"), "search:cont").row();
      k.text(t(s, "btnMenu"), "go:menu");
      return { text: lines.join("\n"), kb: k };
    },

    cancel: async (s, ctx) => {
      const r = await ownRequest(ctx, s.ui.req);
      if (!r) return { redirect: "reqs" };
      if (r.status === "cancelled") return { redirect: "req" };
      return { text: t(s, "cancelQ"), kb: kb().text(t(s, "btnYesCancel"), "rqy:" + r.id).text(t(s, "btnKeep"), "rq:" + r.id) };
    },

    menu: (s) => {
      const k = kb().text(t(s, "btnSupport"), "go:supportIntro").row()
        .text(t(s, "btnFindSpec"), "go:sections").row()
        .text(t(s, "btnMyReqs"), "go:reqs").row()
        .text(t(s, "btnSettings"), "go:settings").row();
      const favs = s.q.fav.map(profile).filter(Boolean);
      let text = t(s, "menuQ");
      if (favs.length) {
        text += "\n\n" + t(s, "favTitle");
        favs.forEach((pr) => k.text("★ " + pr.name + " — " + dirLabel(s, pr.dir), "card:" + pr.id).row());
      }
      return { text, kb: k };
    },

    settings: (s) => {
      const p = s.p;
      const lines = [t(s, "settingsQ"), "",
        t(s, "lName") + ": <b>" + esc(fullName(p) || t(s, "notSet")) + "</b>",
        t(s, "lCity") + ": <b>" + esc(cityLabel(s, p.city)) + "</b>",
        t(s, "lPhone") + ": <b>" + esc(p.phone || t(s, "notSet")) + "</b>",
        t(s, "lAge") + ": <b>" + esc(ageLabel(s, p.age)) + "</b>",
        t(s, "lTopic") + ": <b>" + esc(topicLabel(s, p.topic)) + "</b>"];
      const k = pairs(kb(), [
        [t(s, "btnEdName"), "ed:name"], [t(s, "btnEdPhone"), "ed:phone"],
        [t(s, "btnEdCity"), "ed:city"], [t(s, "btnEdAge"), "ed:age"]
      ]);
      k.text(t(s, s.notify ? "btnNotifyOn" : "btnNotifyOff"), "notify").row();
      k.text(t(s, "btnLangSwitch"), "langsw").row();
      k.text(t(s, "btnMenu"), "go:menu");
      return { text: lines.join("\n"), kb: k };
    },

    restart: (s) => ({
      text: t(s, "restartQ"),
      kb: kb().text(t(s, "btnRestartYes"), "restart:yes").row().text(t(s, "btnRestartNo"), "restart:no")
    })
  };

  // Экраны, из которых редактируют отдельное поле (после ответа бот возвращается туда).
  const RETURN_SCREENS = ["reviewSupport", "reviewSpec", "conditions", "settings", "supportIntro"];
  const EDITABLE = ["name", "phone", "city", "age", "themes", "time", "sections", "clang", "fmt", "budget"];

  // ---------- Сводки (они же — состав отправляемых данных) ----------
  // view — язык, на котором показывается сводка; язык консультации — всегда язык интерфейса родителя (s).
  function supportLines(s, view) {
    const p = s.p;
    const v = view || s;
    const out = [[t(v, "lName"), fullName(p) || t(v, "notSet")], [t(v, "lCity"), cityLabel(v, p.city)],
      [t(v, "lPhone"), p.phone || t(v, "notSet")]];
    if (p.age !== null && p.age !== AGE_NONE) out.push([t(v, "lAge"), ageLabel(v, p.age)]);
    out.push([t(v, "lTopic"), topicLabel(v, p.topic)], [t(v, "lConsultLang"), t(v, L(s) === "kk" ? "langKk" : "langRu")],
      [t(v, "lTime"), timeLabel(v, p.time)]);
    return out;
  }

  function conditionLines(s) {
    const q = s.q;
    const fmt = q.fmt !== null ? lbl(s, FORMATS[q.fmt]) : t(s, "notSet");
    return [[t(s, "lDir"), dirLabel(s, q.dir)], [t(s, "lAge"), ageLabel(s, s.p.age)],
      [t(s, "lClassLang"), q.clang !== null ? lbl(s, CLASS_LANGS[q.clang]) : t(s, "notSet")],
      [t(s, "lFormatCity"), fmt + ", " + cityLabel(s, s.p.city)], [t(s, "lBudget"), budgetLabel(s, q.budget)]];
  }

  function specLines(s, pr, view) {
    const p = s.p, q = s.q, v = view || s;
    return [[t(v, "lSpecialist"), pr.name + " — " + dirLabel(v, pr.dir)], [t(v, "lName"), fullName(p) || t(v, "notSet")],
      [t(v, "lCity"), cityLabel(v, p.city)], [t(v, "lPhone"), p.phone || t(v, "notSet")], [t(v, "lAge"), ageLabel(v, p.age)],
      [t(v, "lClassLang"), q.clang !== null ? lbl(v, CLASS_LANGS[q.clang]) : t(v, "notSet")],
      [t(v, "lFormat"), q.fmt !== null ? lbl(v, FORMATS[q.fmt]) : t(v, "notSet")], [t(v, "lBudget"), budgetLabel(v, q.budget)],
      [t(v, "lPrice"), priceLabel(v, pr).replace(/&amp;/g, "&")]];
  }

  function reqLabel(s, r) {
    if (r.kind === "specialist") return (r.snapshot.spec_name || "") + " — " + dirLabel(s, r.snapshot.spec_dir);
    return TEXT[L(s)].reqSupportLabel.replace("{city}", r.snapshot.city || "");
  }

  async function ownRequest(ctx, id) {
    if (!id) return null;
    const r = await requests.get(id);
    return r && String(r.chat_id) === String(ctx.chat.id) ? r : null;
  }

  // ---------- Сотрудники ----------
  const isStaffChat = (ctx) => !!(staffChatId && ctx.chat && String(ctx.chat.id) === staffChatId);

  async function notifyStaff(ctx, text, keyboard) {
    if (!staffChatId) return false;
    await ctx.api.sendMessage(staffChatId, text, { parse_mode: "HTML", reply_markup: keyboard });
    return true;
  }

  function staffCard(r, from) {
    const ru = { lang: "ru" };
    const title = r.kind === "support" ? "Психологическая поддержка" : "Обращение к специалисту";
    const lines = ["<b>" + title + "</b> · " + statusLabel(ru, r.status), "#" + r.id.slice(0, 8)];
    (r.snapshot.staff || []).forEach(([k, v]) => lines.push(esc(k) + ": " + esc(v)));
    if (r.proposal && (r.status === "proposed" || r.status === "confirmed")) {
      lines.push((r.status === "confirmed" ? "Встреча: " : "Предложено: ") + esc(proposalLabel(ru, r.proposal)));
    }
    if (from) lines.push("Telegram: " + (from.username ? "@" + esc(from.username) : "без username") + ", id " + from.id);
    return lines.join("\n");
  }

  function staffKeyboard(r) {
    const k = kb();
    if (r.status === "cancelled") return k;
    if (r.kind === "support") k.text("Предложить время", "st:time:" + r.id);
    else k.text("Специалист готов", "st:ready:" + r.id).row().text("Другой ответ", "st:ans:" + r.id);
    return k;
  }

  // Уведомление родителю от имени сотрудника — на языке родителя; если уведомления выключены, статус виден в «Мои обращения».
  async function pushUser(ctx, r, kind) {
    const us = (await storage.read(String(r.chat_id))) || {};
    if (us.notify === false) return;
    const s = { lang: us.lang || r.snapshot.lang || "ru" };
    let text;
    const k = kb();
    if (kind === "proposed") {
      text = t(s, "proposal", { when: proposalLabel(s, r.proposal) });
      k.text(t(s, "btnFits"), "rqok:" + r.id).text(t(s, "btnOtherTime"), "rqno:" + r.id).row();
    } else {
      text = r.answer ? t(s, "answerOther", { text: r.answer }) : t(s, "specReady");
      k.text(t(s, "btnSearchSpecs"), "search:cont").row().text(t(s, "btnCancelReq"), "rqc:" + r.id).row();
    }
    k.text(t(s, "btnMyReqs"), "go:reqs");
    text = "<b>" + esc(reqLabel(s, r)) + "</b>\n" + text;
    await ctx.api.sendMessage(r.chat_id, text, { parse_mode: "HTML", reply_markup: k });
  }

  // ---------- Отправка обращения ----------
  function buildSnapshot(s, kind, pr) {
    // lines — на языке родителя (для «Какие сведения были включены»), staff — по-русски для сотрудника.
    const ru = { lang: "ru" };
    const lines = kind === "support" ? supportLines(s) : specLines(s, pr);
    const staff = kind === "support" ? supportLines(s, ru) : specLines(s, pr, ru);
    staff.push(["Язык интерфейса родителя", L(s) === "kk" ? "казахский" : "русский"]);
    return {
      lang: L(s), lines, staff,
      city: cityLabel(s, s.p.city),
      spec_id: pr ? pr.id : null, spec_name: pr ? pr.name : null, spec_dir: pr ? pr.dir : null
    };
  }

  async function saveLeadCopy(ctx, s, r) {
    if (!supabase) return;
    const from = ctx.from || {};
    const msg = ("Telegram-бот, " + (r.kind === "support" ? "психологическая поддержка" : "обращение к специалисту") + ": " +
      r.snapshot.staff.map(([k, v]) => k + ": " + v).join("; ") +
      "; обращение " + r.id + ", user_id " + from.id + ", username " + (from.username ? "@" + from.username : "не указан")).slice(0, 1000);
    const res = await supabase.from("leads").insert({ name: fullName(s.p).slice(0, 100), contact: s.p.phone, message: msg });
    if (res.error) throw new Error("leads insert: " + res.error.message);
  }

  async function submit(ctx, kind) {
    const s = ctx.session;
    const review = kind === "support" ? "reviewSupport" : "reviewSpec";
    // Обязательные поля проверяются заново — в том числе в восстановленной старой сессии.
    const miss = missingRequired(s);
    if (miss) {
      s.ret = review;
      s.ui.err = t(s, "missingField");
      return show(ctx, miss);
    }
    let pr = null;
    if (kind === "support") {
      // Время не выбрано, из старого формата или день уже прошёл — выбрать заново и вернуться к проверке.
      if (!timeValid(s.p.time)) { s.ret = review; return show(ctx, "time"); }
      if (!(s.p.city && s.p.city.id && SUPPORT_CITIES.indexOf(s.p.city.id) !== -1)) return show(ctx, "supportIntro");
    } else {
      pr = profile(s.ui.spec);
      if (!pr) return show(ctx, "results");
      if (missingCondition(s) || !canRequest(pr) || !matches(pr, s)) return show(ctx, "specMismatch");
    }

    s.ui.retry = kind;
    let r;
    try {
      // Повторная отправка того же активного обращения открывает существующее, а не создаёт дубль.
      const list = await requests.list(ctx.chat.id);
      const dup = list.find((x) => x.kind === (kind === "support" ? "support" : "specialist") && x.status !== "cancelled" &&
        (kind === "support" || x.snapshot.spec_id === pr.id));
      if (dup) { s.ui.req = dup.id; s.ui.info = false; return show(ctx, "req"); }
      r = await requests.create({
        chat_id: ctx.chat.id, kind: kind === "support" ? "support" : "specialist", status: "accepted",
        snapshot: buildSnapshot(s, kind, pr)
      });
    } catch (err) {
      logError("submit", err);
      return show(ctx, "sendFail");
    }
    s.ui.req = r.id;
    s.ui.retry = null;
    try { await saveLeadCopy(ctx, s, r); } catch (err) { logError("leads", err); }
    try { await notifyStaff(ctx, "Новое обращение\n" + staffCard(r, ctx.from), staffKeyboard(r)); } catch (err) { logError("notifyStaff", err); }
    return show(ctx, kind === "support" ? "supportAccepted" : "specAccepted");
  }

  // ---------- Приветствие I-HELP × MamaPro ----------
  // Отдельное сообщение при /start (картинка с подписью). Не шаг сценария: s.screen не меняет,
  // поэтому повторный /start не сбивает точку продолжения. Состояние кнопки — по анкете:
  //   new — анкета не начата → «Начать знакомство»; cont — не завершена → «Продолжить»; done → «Открыть меню».
  function welcomeState(s) {
    const p = s.p;
    if (p.first && p.last && p.phone && topicOf(p.topic)) return "done";
    if (!p.city && !p.first && !p.phone && p.age === null && !p.topic) return "new";
    return "cont";
  }

  function welcomeView(s, lang) {
    const v = { lang };
    const k = kb();
    if (!s.lang) k.text("Қазақша", "wl:kk").text("Русский", "wl:ru");
    else {
      const st = welcomeState(s);
      k.text(t(v, st === "new" ? "btnStartIntro" : st === "cont" ? "btnContinue" : "btnOpenMenu"), "wl:go");
    }
    return { caption: t(v, "welcome"), kb: k };
  }

  async function sendWelcome(ctx) {
    const s = ctx.session;
    const code = ctx.from && ctx.from.language_code;
    // До выбора языка — язык Telegram (ru/kk), иначе русский; это только язык показа, не язык сервиса.
    const lang = s.lang || (code === "kk" || code === "ru" ? code : "ru");
    const view = welcomeView(s, lang);
    const extra = { caption: view.caption, parse_mode: "HTML", reply_markup: view.kb };
    let sent = null;
    if (deps.InputFile) {
      try {
        sent = await ctx.api.sendPhoto(ctx.chat.id, welcomeFileId || new deps.InputFile(welcomeImage(), "i-help.jpg"), extra);
      } catch (err) {
        if (!welcomeFileId) throw err;
        welcomeFileId = null; // file_id устарел — загружаем картинку заново
        sent = await ctx.api.sendPhoto(ctx.chat.id, new deps.InputFile(welcomeImage(), "i-help.jpg"), extra);
      }
      const sizes = sent.photo || [];
      if (sizes.length) welcomeFileId = sizes[sizes.length - 1].file_id;
    } else {
      sent = await ctx.api.sendMessage(ctx.chat.id, view.caption, { parse_mode: "HTML", reply_markup: view.kb });
    }
    s.welcome = sent.message_id;
    s.welcomeUsed = false;
    s.msgId = null; // следующий экран — новым сообщением под приветствием
  }

  // Обновить то же приветствие (после выбора языка): подпись у картинки или текст, если картинки нет.
  async function updateWelcome(ctx, keyboard) {
    const s = ctx.session;
    const msg = ctx.callbackQuery.message;
    const view = welcomeView(s, L(s));
    const extra = { parse_mode: "HTML", reply_markup: keyboard || view.kb };
    try {
      if (msg.photo) await ctx.api.editMessageCaption(ctx.chat.id, msg.message_id, Object.assign({ caption: view.caption }, extra));
      else await ctx.api.editMessageText(ctx.chat.id, msg.message_id, view.caption, extra);
    } catch (err) {
      if (!isNotModified(err)) throw err;
    }
  }

  // ---------- Бот ----------
  const bot = new deps.Bot(deps.token, deps.botConfig);

  bot.use(deps.session({
    initial: initialState,
    storage,
    getSessionKey: (ctx) => {
      const u = ctx.update;
      const chat = ctx.chat || (u.widget_query && u.widget_query.chat);
      return chat ? String(chat.id) : undefined;
    }
  }));

  // Старый формат сессии (до сценария mama.md) — начинаем заново.
  bot.use(async (ctx, next) => {
    const hasKey = ctx.chat || (ctx.update.widget_query && ctx.update.widget_query.chat);
    if (hasKey && (!ctx.session || ctx.session.v !== SESSION_VERSION)) ctx.session = initialState();
    await next();
  });

  bot.use(async (ctx, next) => {
    await refreshSpecialists();
    await next();
  });

  // Закрываем «часики» на кнопке (с всплывающим сообщением, если обработчик его оставил).
  bot.on("callback_query:data", async (ctx, next) => {
    try {
      await next();
    } finally {
      await ctx.answerCallbackQuery(ctx.toast ? { text: ctx.toast, show_alert: true } : undefined).catch(() => {});
    }
  });

  // Неактивные клетки календаря (подписи, прошедшие дни): только закрываем «часики».
  bot.callbackQuery("noop", () => {});

  // id чата — чтобы настроить служебный чат сотрудников (STAFF_CHAT_ID).
  bot.command("chatid", (ctx) => ctx.reply("chat id: " + ctx.chat.id));

  // ----- Служебный чат сотрудников -----
  // Календарь сотрудника: дата → время встречи. Текстом — запасной вариант («Написать текстом»).
  function staffCalendar(r, key) {
    const k = addCalendar(kb(), "ru", key, (d) => "sd:" + r.id + ":" + d, (m) => "sn:" + r.id + ":" + m);
    k.text("Написать текстом", "st:text:" + r.id);
    return k;
  }

  async function staffRequest(ctx, id) {
    if (!isStaffChat(ctx)) return null;
    const r = await requests.get(id);
    if (!r) { ctx.toast = "Обращение не найдено"; return null; }
    if (r.status === "cancelled") { ctx.toast = "Обращение отменено родителем"; return null; }
    return r;
  }

  bot.callbackQuery(/^sn:([\w-]+):(\d{6})$/, async (ctx) => {
    const r = await staffRequest(ctx, ctx.match[1]);
    if (!r) return;
    await ctx.editMessageText("Обращение #" + r.id.slice(0, 8) + ": выберите дату встречи (время Алматы).",
      { reply_markup: staffCalendar(r, ctx.match[2]) }).catch(() => {});
  });

  bot.callbackQuery(/^sd:([\w-]+):(\d{8})$/, async (ctx) => {
    const r = await staffRequest(ctx, ctx.match[1]);
    if (!r) return;
    const ms = parseDate(ctx.match[2]);
    if (!inCalendar(ms)) { ctx.toast = "Эту дату выбрать нельзя"; return; }
    const k = pairs3(kb(), MEETING_SLOTS.map((h) => [h, "ss:" + r.id + ":" + ctx.match[2] + ":" + h.replace(":", "")]));
    k.text("← Другой день", "sn:" + r.id + ":" + monthKey(ms));
    await ctx.editMessageText("Обращение #" + r.id.slice(0, 8) + ": " + dayLabel("ru", ms) + ". Выберите время встречи (время Алматы).",
      { reply_markup: k }).catch(() => {});
  });

  bot.callbackQuery(/^ss:([\w-]+):(\d{8}):(\d{4})$/, async (ctx) => {
    const r = await staffRequest(ctx, ctx.match[1]);
    if (!r) return;
    const ms = parseDate(ctx.match[2]);
    const time = ctx.match[3].slice(0, 2) + ":" + ctx.match[3].slice(2);
    if (!inCalendar(ms) || MEETING_SLOTS.indexOf(time) === -1) { ctx.toast = "Это время выбрать нельзя"; return; }
    const u = await requests.update(r.id, { status: "proposed", proposal: isoDate(ms) + " " + time });
    await pushUser(ctx, u, "proposed");
    await ctx.editMessageText("✅ Отправлено родителю.\n" + staffCard(u), { parse_mode: "HTML", reply_markup: staffKeyboard(u) }).catch(() => {});
  });

  bot.callbackQuery(/^st:(time|text|ready|ans):([\w-]+)$/, async (ctx) => {
    if (!isStaffChat(ctx)) return;
    const action = ctx.match[1];
    const r = await requests.get(ctx.match[2]);
    if (!r) { ctx.toast = "Обращение не найдено"; return; }
    if (r.status === "cancelled") { ctx.toast = "Обращение отменено родителем"; return; }
    if (action === "time") {
      await ctx.reply("Обращение #" + r.id.slice(0, 8) + ": выберите дату встречи (время Алматы).",
        { reply_markup: staffCalendar(r, null) });
      return;
    }
    if (action === "ready") {
      const u = await requests.update(r.id, { status: "answered", answer: null });
      await pushUser(ctx, u, "answered");
      await ctx.editMessageText(staffCard(u) + "\n\n✅ Родителю отправлено: специалист готов обсудить встречу.", { parse_mode: "HTML" }).catch(() => {});
      return;
    }
    const prompt = action === "text"
      ? "Обращение #" + r.id.slice(0, 8) + ": напишите ответом на это сообщение дату и время встречи с часовым поясом."
      : "Обращение #" + r.id.slice(0, 8) + ": напишите ответом на это сообщение ответ специалиста для родителя.";
    const sent = await ctx.reply(prompt, {
      reply_markup: { force_reply: true, input_field_placeholder: action === "text" ? "16 ноября, 11:00 (время Алматы)" : "Ответ специалиста" }
    });
    ctx.session.staff = { msg: sent.message_id, action: action === "text" ? "time" : action, id: r.id };
  });

  bot.on("message:text", async (ctx, next) => {
    const w = ctx.session && ctx.session.staff;
    const reply = ctx.message.reply_to_message;
    if (!isStaffChat(ctx) || !w || !reply || reply.message_id !== w.msg) return next();
    const text = ctx.message.text.trim().slice(0, 300);
    if (!text) return;
    ctx.session.staff = null;
    const r = await requests.get(w.id);
    if (!r || r.status === "cancelled") return ctx.reply("Обращение отменено родителем — ответ не отправлен.");
    const u = w.action === "time"
      ? await requests.update(r.id, { status: "proposed", proposal: text })
      : await requests.update(r.id, { status: "answered", answer: text });
    await pushUser(ctx, u, u.status);
    await ctx.reply("✅ Отправлено родителю.\n" + staffCard(u), { parse_mode: "HTML", reply_markup: staffKeyboard(u) });
  });

  // В группах (кроме служебного чата выше) бот молчит.
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== "private") return;
    await next();
  });

  // ----- Виджет (эксперимент, выключен флагом WIDGETS_ENABLED) -----
  if (deps.extend) {
    deps.extend(bot, {
      logError,
      // Заявка из виджета: продолжаем обычный сценарий в чате (выбор языка или главное меню).
      startLead: async (ctx, chatId) => {
        ctx.session.msgId = null;
        await show(ctx, ctx.session.lang ? "menu" : "lang", chatId);
      }
    });
  }

  // ----- Команды -----
  bot.command("start", (ctx) => {
    const s = ctx.session;
    // /start-ссылка с параметром: сохраняем его, он переживает приветствие и выбор языка.
    if (ctx.match) s.startParam = String(ctx.match).slice(0, 64);
    return sendWelcome(ctx);
  });

  // Выбор языка под приветствием: обновляем то же сообщение, язык сохраняется как язык сервиса.
  bot.callbackQuery(/^wl:(ru|kk)$/, (ctx) => {
    ctx.session.lang = ctx.match[1];
    return updateWelcome(ctx);
  });

  // «Начать знакомство» / «Продолжить» / «Открыть меню».
  bot.callbackQuery("wl:go", async (ctx) => {
    const s = ctx.session;
    if (!s.lang) return updateWelcome(ctx);
    const msgId = ctx.callbackQuery.message && ctx.callbackQuery.message.message_id;
    // Повторное нажатие на то же приветствие не запускает вторую анкету.
    if (s.welcomeUsed && s.welcome === msgId) return;
    s.welcome = msgId;
    s.welcomeUsed = true;
    // Кнопку под приветствием убираем: дальше разговор идёт в сообщениях ниже.
    await ctx.api.editMessageReplyMarkup(ctx.chat.id, msgId, { reply_markup: { inline_keyboard: [] } }).catch(() => {});
    s.msgId = null;
    s.ret = null;
    const st = welcomeState(s);
    if (st === "new") return show(ctx, "city");
    if (st === "done") return show(ctx, "menu");
    return show(ctx, !s.screen || s.screen === "lang" || s.screen === "welcome" ? "city" : s.screen);
  });

  bot.command("menu", (ctx) => {
    const s = ctx.session;
    s.msgId = null;
    s.ret = null;
    return show(ctx, "menu");
  });

  bot.command("language", (ctx) => {
    ctx.session.msgId = null;
    ctx.session.ui.prev = ctx.session.screen;
    ctx.session.lang = null;
    return show(ctx, "lang");
  });

  bot.command("restart", (ctx) => {
    const s = ctx.session;
    s.msgId = null;
    if (!s.lang) return show(ctx, "lang");
    s.ui.prev = s.screen;
    return show(ctx, "restart");
  });

  bot.callbackQuery(/^restart:(yes|no)$/, async (ctx) => {
    const s = ctx.session;
    if (ctx.match[1] === "yes") {
      const msgId = s.msgId;
      ctx.session = initialState();
      ctx.session.msgId = msgId;
      return sendWelcome(ctx); // как первый запуск: приветствие с выбором языка
    }
    return show(ctx, s.ui.prev || "menu");
  });

  // ----- Навигация -----
  bot.callbackQuery(/^go:(\w+)$/, (ctx) => {
    const s = ctx.session;
    const name = ctx.match[1];
    if (name === s.ret || name === "menu") s.ret = null;
    return show(ctx, name);
  });

  // Редактирование одного поля из сводки, условий или настроек.
  bot.callbackQuery(/^ed:(\w+)$/, (ctx) => {
    const s = ctx.session;
    const field = ctx.match[1];
    if (EDITABLE.indexOf(field) === -1) return show(ctx, s.screen);
    if (RETURN_SCREENS.indexOf(s.screen) !== -1) s.ret = s.screen;
    if (field === "budget") s.ui.tmpBudget = null;
    if (field === "name") s.ui.pendingFirst = null;
    return show(ctx, field);
  });

  bot.callbackQuery(/^lang:(ru|kk)$/, (ctx) => {
    const s = ctx.session;
    const first = !s.p.first && !s.p.city;
    s.lang = ctx.match[1];
    if (first) { s.msgId = null; return show(ctx, "city"); }
    const prev = s.ui.prev;
    s.ui.prev = null;
    return show(ctx, prev && prev !== "lang" ? prev : "menu");
  });

  bot.callbackQuery("langsw", (ctx) => {
    ctx.session.lang = ctx.session.lang === "kk" ? "ru" : "kk";
    return show(ctx, "settings");
  });

  bot.callbackQuery("notify", (ctx) => {
    ctx.session.notify = !ctx.session.notify;
    return show(ctx, "settings");
  });

  // ----- Анкета -----
  bot.callbackQuery(/^city:(\d+)$/, (ctx) => {
    const c = CITIES[Number(ctx.match[1])];
    if (!c) return show(ctx, "city");
    ctx.session.p.city = { id: c.id };
    return advance(ctx, "name");
  });
  bot.callbackQuery("city:other", (ctx) => show(ctx, "cityOther"));
  bot.callbackQuery("city:ok", (ctx) => advance(ctx, "name"));

  bot.callbackQuery(/^age:(\d+)$/, (ctx) => {
    const i = Number(ctx.match[1]);
    if (!AGES[i]) return show(ctx, "age");
    ctx.session.p.age = i;
    return advance(ctx, "themes");
  });

  bot.callbackQuery(/^theme:(\d+)$/, (ctx) => {
    const i = Number(ctx.match[1]);
    if (!THEMES[i]) return show(ctx, "themes");
    ctx.session.ui.theme = i;
    return show(ctx, "topics");
  });

  bot.callbackQuery(/^topic:(\d+)$/, (ctx) => {
    const s = ctx.session;
    const key = s.ui.theme + ":" + ctx.match[1];
    if (!topicOf(key)) return show(ctx, "themes");
    s.p.topic = key;
    return advance(ctx, "next");
  });

  // Календарь родителя: листание месяцев, выбор дня, выбор времени.
  bot.callbackQuery(/^cal:m:(\d{6})$/, (ctx) => {
    ctx.session.ui.calMonth = clampMonth(ctx.match[1]);
    return show(ctx, "time");
  });

  bot.callbackQuery(/^cal:d:(\d{8})$/, (ctx) => {
    const ms = parseDate(ctx.match[1]);
    if (!inCalendar(ms)) return show(ctx, "time");
    ctx.session.ui.calDate = isoDate(ms);
    ctx.session.ui.calMonth = monthKey(ms);
    return show(ctx, "timeSlot");
  });

  bot.callbackQuery(/^slot:(\d{4}|any)$/, (ctx) => {
    const s = ctx.session;
    const ms = parseDate(s.ui.calDate);
    if (!inCalendar(ms)) return show(ctx, "time");
    const v = ctx.match[1];
    const time = v === "any" ? null : v.slice(0, 2) + ":" + v.slice(2);
    if (time && CONTACT_SLOTS.indexOf(time) === -1) return show(ctx, "timeSlot");
    s.p.time = { date: isoDate(ms), time };
    return advance(ctx, "reviewSupport");
  });

  // ----- Поиск -----
  bot.callbackQuery(/^sec:(\d+)$/, (ctx) => {
    const i = Number(ctx.match[1]);
    if (!SECTIONS[i]) return show(ctx, "sections");
    ctx.session.ui.sec = i;
    return show(ctx, "dirs");
  });

  bot.callbackQuery(/^dir:(\d+)$/, (ctx) => {
    const s = ctx.session;
    const key = s.ui.sec + ":" + ctx.match[1];
    if (!dirOf(key)) return show(ctx, "sections");
    if (s.q.dir !== key) { s.q.cmp = []; s.q.idx = 0; } // сравнение очищается при смене направления
    s.q.dir = key;
    return advance(ctx, "clang");
  });

  bot.callbackQuery(/^clang:(\d+)$/, (ctx) => {
    const i = Number(ctx.match[1]);
    if (!CLASS_LANGS[i]) return show(ctx, "clang");
    ctx.session.q.clang = i;
    return advance(ctx, "fmt");
  });

  bot.callbackQuery(/^fmt:(\d+)$/, (ctx) => {
    const i = Number(ctx.match[1]);
    if (!FORMATS[i]) return show(ctx, "fmt");
    ctx.session.q.fmt = i;
    return advance(ctx, "budget");
  });

  // «Посмотреть онлайн»: меняется только формат, остальные условия сохраняются.
  bot.callbackQuery("fmt:online", (ctx) => {
    ctx.session.q.fmt = FORMATS.findIndex((f) => f.id === "on");
    ctx.session.ret = null;
    return show(ctx, "conditions");
  });

  bot.callbackQuery(/^bud:(\d+|custom)$/, (ctx) => {
    const s = ctx.session;
    if (ctx.match[1] === "custom") {
      if (s.ui.tmpBudget === null || s.ui.tmpBudget === undefined) return show(ctx, "budget");
      s.q.budget = s.ui.tmpBudget;
    } else {
      const i = Number(ctx.match[1]);
      if (BUDGETS[i] === undefined) return show(ctx, "budget");
      s.q.budget = BUDGETS[i];
    }
    s.ui.tmpBudget = null;
    return advance(ctx, "conditions");
  });

  bot.callbackQuery(/^res:(show|\d+)$/, (ctx) => {
    const s = ctx.session;
    if (ctx.match[1] === "show") {
      s.ret = null;
      s.q.idx = 0;
      const miss = missingCondition(s);
      if (miss) return show(ctx, miss);
    } else {
      s.q.idx = Number(ctx.match[1]);
    }
    return show(ctx, "results");
  });

  bot.callbackQuery("search:cont", (ctx) => {
    const s = ctx.session;
    s.ret = null;
    const miss = missingCondition(s);
    return show(ctx, !miss ? "results" : miss === "sections" ? "sections" : "conditions");
  });

  bot.callbackQuery(/^card:(\w+)$/, (ctx) => {
    if (!profile(ctx.match[1])) return show(ctx, "results");
    ctx.session.ui.spec = ctx.match[1];
    return show(ctx, "profile");
  });

  bot.callbackQuery(/^fav:(\w+)$/, (ctx) => {
    const s = ctx.session;
    const id = ctx.match[1];
    if (profile(id)) {
      const at = s.q.fav.indexOf(id);
      if (at !== -1) s.q.fav.splice(at, 1); else s.q.fav.push(id);
    }
    return show(ctx, s.screen);
  });

  bot.callbackQuery(/^cmp:(\w+)$/, (ctx) => {
    const s = ctx.session;
    const id = ctx.match[1];
    if (profile(id)) {
      const at = s.q.cmp.indexOf(id);
      if (at !== -1) s.q.cmp.splice(at, 1);
      else if (s.q.cmp.length >= 2) ctx.toast = t(s, "cmpFull").replace(/<[^>]+>/g, "");
      else s.q.cmp.push(id);
    }
    return show(ctx, s.screen);
  });

  bot.callbackQuery(/^cmpx:(\w+)$/, (ctx) => {
    const s = ctx.session;
    s.q.cmp = s.q.cmp.filter((x) => x !== ctx.match[1]); // избранное не трогаем
    return show(ctx, "compare");
  });

  bot.callbackQuery(/^prep:(\w+)$/, (ctx) => {
    const pr = profile(ctx.match[1]);
    if (!pr) return show(ctx, "results");
    ctx.session.ui.spec = pr.id;
    ctx.session.ret = null;
    return show(ctx, "reviewSpec");
  });

  bot.callbackQuery(/^send:(support|spec)$/, (ctx) => submit(ctx, ctx.match[1]));

  // ----- Мои обращения -----
  bot.callbackQuery(/^rq:([\w-]+)$/, (ctx) => {
    ctx.session.ui.req = ctx.match[1];
    ctx.session.ui.info = false;
    return show(ctx, "req");
  });

  bot.callbackQuery(/^rqi:([\w-]+)$/, (ctx) => {
    const s = ctx.session;
    s.ui.info = s.ui.req === ctx.match[1] ? !s.ui.info : true;
    s.ui.req = ctx.match[1];
    return show(ctx, "req");
  });

  bot.callbackQuery(/^rqc:([\w-]+)$/, (ctx) => {
    ctx.session.ui.req = ctx.match[1];
    return show(ctx, "cancel");
  });

  bot.callbackQuery(/^rqy:([\w-]+)$/, async (ctx) => {
    const s = ctx.session;
    s.ui.req = ctx.match[1];
    s.ui.info = false;
    const r = await ownRequest(ctx, s.ui.req);
    if (!r) return show(ctx, "reqs");
    if (r.status === "cancelled") return show(ctx, "req"); // повторная отмена ничего не меняет
    const u = Object.assign({}, r, { status: "cancelled" });
    // Отмена подтверждённой встречи завершается, только когда дошла до сотрудника.
    try {
      await notifyStaff(ctx, "Родитель отменил обращение\n" + staffCard(u, ctx.from), undefined);
    } catch (err) {
      logError("notifyStaff", err);
      if (r.status === "confirmed") { s.ui.err = t(s, "cancelFail"); return show(ctx, "req"); }
    }
    await requests.update(r.id, { status: "cancelled" });
    s.ui.flash = t(s, "cancelled");
    return show(ctx, "req");
  });

  bot.callbackQuery(/^rq(ok|no):([\w-]+)$/, async (ctx) => {
    const s = ctx.session;
    s.ui.req = ctx.match[2];
    s.ui.info = false;
    const r = await ownRequest(ctx, s.ui.req);
    if (!r) return show(ctx, "reqs");
    if (r.status !== "proposed") return show(ctx, "req");
    let u;
    if (ctx.match[1] === "ok") {
      u = await requests.update(r.id, { status: "confirmed" });
      s.ui.flash = t(s, "confirmed", { when: proposalLabel(s, r.proposal) });
    } else {
      u = await requests.update(r.id, { status: "accepted", proposal: null });
      s.ui.flash = t(s, "otherTimeAck");
    }
    try {
      await notifyStaff(ctx, (ctx.match[1] === "ok" ? "Родитель подтвердил время" : "Родителю нужно другое время") +
        "\n" + staffCard(u, ctx.from), staffKeyboard(u));
    } catch (err) { logError("notifyStaff", err); }
    return show(ctx, "req");
  });

  // ----- Ввод текстом: город, имя и фамилия, телефон, своя сумма -----
  async function onPhone(ctx, raw) {
    const s = ctx.session;
    const v = String(raw).trim();
    const digits = v.replace(/\D/g, "");
    if (!/^\+?[\d\s()-]+$/.test(v) || digits.length < 10 || digits.length > 15) {
      s.ui.err = t(s, "phoneErr") + "\n" + t(s, "youEntered", { v: v.slice(0, 40) });
      return show(ctx, "phone");
    }
    s.p.phone = (v.charAt(0) === "+" ? "+" : "") + digits;
    return advance(ctx, "age");
  }

  bot.on("message:contact", async (ctx) => {
    const s = ctx.session;
    await ctx.deleteMessage().catch(() => {});
    if (s.screen !== "phone") return;
    return onPhone(ctx, ctx.message.contact.phone_number);
  });

  bot.on("message:text", async (ctx) => {
    const s = ctx.session;
    const text = ctx.message.text.trim();
    if (!s.lang) return sendWelcome(ctx); // ещё не начинали — приветствие с выбором языка
    if (text.charAt(0) === "/") {
      s.msgId = null;
      return show(ctx, "menu");
    }
    const screen = s.screen;

    if (screen === "cityOther") {
      await ctx.deleteMessage().catch(() => {});
      if (text.length < 2 || text.length > 60) { s.ui.err = t(s, "cityOtherErr"); return show(ctx, "cityOther"); }
      s.p.city = { name: text };
      return show(ctx, "cityOnline");
    }

    if (screen === "name") {
      await ctx.deleteMessage().catch(() => {});
      const parts = text.split(/\s+/).filter(Boolean);
      let first, last;
      if (s.ui.pendingFirst && parts.length === 1) { first = s.ui.pendingFirst; last = parts[0]; }
      else { first = parts[0] || ""; last = parts.slice(1).join(" "); }
      if (!first) { s.ui.err = t(s, "nameErrFirst"); return show(ctx, "name"); }
      const okChars = [first].concat(last ? last.split(" ") : []).every((w) => NAME_RE.test(w) && w.length <= 50);
      if (!okChars || (first + " " + last).length > 100) { s.ui.pendingFirst = null; s.ui.err = t(s, "nameErrChars"); return show(ctx, "name"); }
      if (!last) { s.ui.pendingFirst = first; s.ui.err = t(s, "nameErrLast"); return show(ctx, "name"); }
      s.p.first = first;
      s.p.last = last;
      s.ui.pendingFirst = null;
      return advance(ctx, "phone");
    }

    if (screen === "phone") {
      await ctx.deleteMessage().catch(() => {});
      return onPhone(ctx, text);
    }

    if (screen === "budget") {
      await ctx.deleteMessage().catch(() => {});
      const v = text.replace(/[\s ₸тг.]/gi, "");
      const n = /^\d+$/.test(v) ? Number(v) : NaN;
      if (!(n >= 0 && n <= BUDGET_MAX)) { s.ui.tmpBudget = null; s.ui.err = t(s, "budgetErr"); return show(ctx, "budget"); }
      s.ui.tmpBudget = n;
      return show(ctx, "budget");
    }

    // Бот не ждёт текста: показываем текущий шаг заново внизу чата.
    s.msgId = null;
    s.ui.err = t(s, "pickButton");
    return show(ctx, screen || "menu");
  });

  // ----- Ошибки -----
  // Изменения сессии в упавшем апдейте не сохраняются: ответы остаются прежними.
  bot.catch(async (err) => {
    logError("bot", err.error || err);
    const ctx = err.ctx;
    try {
      if (ctx && ctx.chat && ctx.chat.type === "private") {
        const s = { lang: ctx.session && ctx.session.lang };
        await ctx.api.sendMessage(ctx.chat.id, t(s, "genericError"), {
          reply_markup: kb().text(t(s, "btnMenu"), "go:menu")
        });
      }
    } catch (e) {
      logError("bot.catch", e);
    }
  });

  return bot;
}
