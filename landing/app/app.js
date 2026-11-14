// Мини-апп I-Help (Telegram Mini App): весь сценарий родителя после приветствия в чате — анкета,
// психологическая поддержка, поиск и сравнение специалистов, обращения, настройки.
// Данные и тексты RU/KZ приходят из API бота (supabase/functions/telegram-bot/api) — одна логика с чатом.
// Полная анкета специалиста открывается на сайте (../specialist.html).
(function () {
  "use strict";

  var tg = window.Telegram && window.Telegram.WebApp;
  var ENV = window.IHELP_ENV || {};
  var params = new URLSearchParams(location.search);
  var API = ENV.API;
  // Для локальной проверки: ?api=... принимается только на localhost.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && params.get("api")) API = params.get("api");
  var initData = tg && tg.initData;

  var $app = document.getElementById("app");
  var $toast = document.getElementById("toast");

  var S = {
    cat: null, st: null, lang: "ru",
    stack: [],
    results: null, inDir: true, profiles: {}, reqs: null, count: null,
    renderId: 0
  };

  // ---------- Утилиты ----------
  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function T(key, vars) {
    var d = S.cat.TEXT[S.lang] || S.cat.TEXT.ru;
    var s = d[key] != null ? d[key] : (S.cat.TEXT.ru[key] != null ? S.cat.TEXT.ru[key] : key);
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? esc(vars[k]) : m; });
    return s;
  }
  function P(key, vars) { return T(key, vars).replace(/<[^>]+>/g, "").replace(/\n+/g, " "); } // без разметки
  function L(o) { return o ? (o[S.lang] || o.ru) : ""; }
  function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₸"; }
  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === "ok") tg.HapticFeedback.notificationOccurred("success");
      else if (kind === "err") tg.HapticFeedback.notificationOccurred("error");
      else tg.HapticFeedback.selectionChanged();
    } catch (e) { /* старый клиент */ }
  }
  var toastTimer = null;
  function toast(text) {
    $toast.textContent = text;
    $toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.hidden = true; }, 3200);
  }

  var ICON = {
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    chev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.4h2c.7-1.3 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>',
    heartO: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20s-7-4.3-9-8.6C1.6 8.2 3.6 5 6.8 5c2 0 3.4 1.1 4.1 2.3h2.2C13.8 6.1 15.2 5 17.2 5c3.2 0 5.2 3.2 3.8 6.4C19 15.7 12 20 12 20z"/></svg>',
    cmp: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M17 4v16M3 8h8M13 16h8"/></svg>',
    check: '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    ext: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    list: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>'
  };
  var SECTION_ICON = ["🗣️", "💭", "🩺", "🤸", "👂", "🍎"];
  var THEME_ICON = ["🧭", "🔎", "🧩", "🤍", "🎒"];
  var AV_COLORS = ["#FF870D", "#740112", "#E85D75", "#B35400", "#8A5A44", "#C2410C"];

  // ---------- Подписи (как в боте) ----------
  function cityLabel(c) {
    if (!c) return P("notSet");
    if (c.id) { var x = S.cat.CITIES.filter(function (y) { return y.id === c.id; })[0]; return x ? L(x) : c.id; }
    return c.name || P("notSet");
  }
  function ageLabel(a) { return a == null || a === S.cat.AGE_NONE ? P("notSet") : L(S.cat.AGES[a]); }
  function topicOf(key) {
    if (typeof key !== "string") return null;
    var k = key.split(":").map(Number), th = S.cat.THEMES[k[0]];
    return th && th.items[k[1]] ? { theme: th, item: th.items[k[1]] } : null;
  }
  function topicLabel(key) { var x = topicOf(key); return x ? L(x.item) : P("notSet"); }
  function dirOf(key) {
    if (typeof key !== "string") return null;
    var k = key.split(":").map(Number), sec = S.cat.SECTIONS[k[0]];
    return sec && sec.dirs[k[1]] ? { sec: k[0], dir: sec.dirs[k[1]] } : null;
  }
  function dirLabel(key) { var x = dirOf(key); return x ? L(x.dir) : P("notSet"); }
  function budgetLabel(b) {
    if (b == null) return P("notSet");
    return b < 0 ? P("budgetNone") : b === 0 ? P("budgetFree") : P("budgetUpTo", { sum: money(b) });
  }
  function priceLabel(pr) {
    if (pr.price == null) return P("priceUnknown");
    var price = pr.price === 0 ? P("free") : money(pr.price);
    return pr.minutes ? P("priceFmt", { price: price, min: pr.minutes }) : price;
  }
  function fmtList(pr) { return pr.formats.map(function (f) { return P(f === "off" ? "fmtOff" : "fmtOn"); }); }
  function langList(pr) { return pr.langs.map(function (l) { return P(l === "kk" ? "langKk" : "langRu"); }); }
  function agesText(pr) { return pr.ages.map(function (a) { return L(S.cat.AGES[a]); }).join(", "); }
  // Коротко для карточки: непрерывный диапазон групп → «3–13 лет» / «от 3 лет» (с группой 18+).
  var AGE_FROM = [0, 3, 6, 10, 14, 18], AGE_TO = [2, 5, 9, 13, 17, null];
  function agesShort(pr) {
    var a = pr.ages.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return "";
    for (var i = 1; i < a.length; i++) if (a[i] !== a[i - 1] + 1) return agesText(pr);
    var from = AGE_FROM[a[0]], to = AGE_TO[a[a.length - 1]];
    if (to == null) return S.lang === "kk" ? from + " жастан бастап" : "от " + from + " " + (from === 0 ? "лет" : "лет");
    return S.lang === "kk" ? from + "–" + to + " жас" : from + "–" + to + " " + (to % 10 >= 2 && to % 10 <= 4 && (to % 100 < 12 || to % 100 > 14) ? "года" : "лет");
  }
  function parseDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  function dayLabel(iso) {
    var ms = parseDate(iso);
    if (isNaN(ms)) return "";
    var d = new Date(ms);
    var wd = S.cat.WEEKDAYS[S.lang][(d.getUTCDay() + 6) % 7].toLowerCase();
    return d.getUTCDate() + " " + S.cat.MONTHS[S.lang].gen[d.getUTCMonth()] + " (" + wd + ")";
  }
  function timeLabel(v) {
    if (v && typeof v === "object" && v.date) {
      var day = dayLabel(v.date);
      return v.time ? P("whenAt", { date: day, time: v.time }) : P("whenAny", { date: day });
    }
    return P("notSet");
  }
  // Опыт: по-русски склоняем (1 год, 3 года, 5 лет), по-казахски «жыл» уже в шаблоне.
  function expLabel(n) {
    if (S.lang === "kk") return P("lExp", { n: n });
    var w = n % 10 === 1 && n % 100 !== 11 ? "год" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "года" : "лет";
    return P("lExp", { n: n + " " + w });
  }
  function fullName(p) { return ((p.first || "") + " " + (p.last || "")).trim(); }
  function initials(name) {
    return String(name).split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase();
  }
  function avatar(pr, cls) {
    var n = 0;
    for (var i = 0; i < pr.id.length; i++) n = (n * 31 + pr.id.charCodeAt(i)) % 997;
    return '<div class="avatar ' + (cls || "") + '" style="--av:' + AV_COLORS[n % AV_COLORS.length] + '">' + esc(initials(pr.name)) + "</div>";
  }
  function availBadge(pr) {
    return '<span class="badge badge--' + esc(pr.availability) + '">' + esc(P("appAvail_" + pr.availability)) + "</span>";
  }
  function supportAvailable() {
    var c = S.st.p.city;
    return !!(c && c.id && S.cat.SUPPORT_CITIES.indexOf(c.id) !== -1);
  }
  function isFav(id) { return S.st.q.fav.indexOf(id) !== -1; }
  function isCmp(id) { return S.st.q.cmp.indexOf(id) !== -1; }

  // ---------- API ----------
  function api(action, extra) {
    var body = Object.assign({ initData: initData, action: action }, extra || {});
    return fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (res) {
        if (res.status === 401) { var e = new Error("unauthorized"); e.auth = true; throw e; }
        if (!res.ok) throw new Error("http " + res.status);
        return res.json();
      });
  }
  function save(patch) {
    return api("save", { patch: patch }).then(function (r) {
      S.st = r.state;
      if (r.state.lang) S.lang = r.state.lang;
      return r.errors || {};
    });
  }
  function fail(err) {
    console.error(err);
    haptic("err");
    toast(err && err.auth ? P("appOpenInTelegram") : P("genericError"));
  }

  // ---------- Навигация ----------
  function top() { return S.stack[S.stack.length - 1]; }
  function go(name, arg, ret) { S.stack.push({ name: name, arg: arg, ret: ret || null }); render(); }
  function reset(name, arg) { S.stack = [{ name: name, arg: arg }]; render(); }
  function back() {
    if (S.stack.length > 1) { S.stack.pop(); render(); }
    else if (tg && tg.close) tg.close();
  }
  function backTo(name) {
    while (S.stack.length > 1 && top().name !== name) S.stack.pop();
    if (top().name !== name) S.stack = [{ name: name }];
    render();
  }
  // После ответа на вопрос: вернуться туда, откуда редактировали, иначе — следующий шаг анкеты.
  function finish(next) {
    var r = top();
    if (r.ret) return backTo(r.ret);
    if (next === "home") return reset("home");
    go(next);
  }
  // Первый незаполненный шаг анкеты.
  function firstStep() {
    var p = S.st.p;
    if (!S.st.lang) return "lang";
    if (!p.city) return "city";
    if (!p.first || !p.last) return "name";
    if (!p.phone) return "phone";
    if (p.age == null) return "age";
    if (!topicOf(p.topic)) return "themes";
    return "home";
  }
  var ONBOARD = { city: 1, cityOther: 1, name: 2, phone: 3, age: 4, themes: 5, topics: 5 };
  function stepHead(r) {
    if (r.ret || S.st.onboarding === "done" || !ONBOARD[r.name]) return "";
    var i = ONBOARD[r.name];
    return '<div class="step">' + esc(P("appStep", { i: i, n: 5 })) + '</div><div class="progress"><i style="width:' + (i / 5 * 100) + '%"></i></div>';
  }

  // ---------- Экраны ----------
  function opt(act, arg, label, extra) {
    extra = extra || {};
    return '<button class="opt' + (extra.cls ? " " + extra.cls : "") + '" data-act="' + act + '" data-arg="' + esc(arg) + '"' +
      (extra.pressed ? ' aria-pressed="true"' : "") + ">" +
      (extra.icon ? '<span class="opt__icon">' + extra.icon + "</span>" : "") +
      '<span class="opt__body">' + esc(label) + (extra.desc ? '<span class="opt__desc">' + esc(extra.desc) + "</span>" : "") + "</span>" +
      (extra.chev === false ? "" : '<span class="opt__chev">' + ICON.chev + "</span>") + "</button>";
  }
  function rows(list, editable) {
    return '<div class="rows">' + list.map(function (r) {
      return '<div class="row"><span class="row__k">' + esc(r[0]) + '</span><span class="row__v">' + esc(r[1]) +
        (editable && r[2] ? '<button class="row__edit" data-act="edit" data-arg="' + esc(r[2]) + '">' + esc(P("appEdit")) + "</button>" : "") +
        "</span></div>";
    }).join("") + "</div>";
  }

  var VIEWS = {
    lang: function () {
      return {
        html: '<h1>Қай тіл сізге ыңғайлы?</h1><p class="sub">На каком языке вам удобнее?</p><div class="opts">' +
          opt("setLang", "kk", "Қазақша", { icon: "🇰🇿" }) + opt("setLang", "ru", "Русский", { icon: "💬" }) + "</div>"
      };
    },

    city: function (r) {
      var c = S.st.p.city;
      return {
        html: stepHead(r) + "<h1>" + esc(P("cityQ")) + '</h1><div class="opts">' +
          S.cat.CITIES.map(function (x) { return opt("city", x.id, L(x), { pressed: c && c.id === x.id }); }).join("") +
          opt("cityOther", "", P("cityOther"), { pressed: c && !!c.name, desc: c && c.name ? c.name : "" }) + "</div>"
      };
    },

    cityOther: function (r) {
      var c = S.st.p.city;
      return {
        html: stepHead(r) + "<h1>" + esc(P("cityOther")) + '</h1><p class="sub">' + esc(P("cityOnline")) + "</p>" +
          '<label class="field"><span class="field__label">' + esc(P("appCityPh")) + '</span>' +
          '<input class="input" id="f-city" maxlength="60" autocomplete="address-level2" value="' + esc(c && c.name ? c.name : "") + '">' +
          '<div class="err" id="e-city" hidden></div></label>',
        footer: '<button class="btn" data-act="saveCity">' + esc(P("btnContinue")) + "</button>",
        focus: "f-city"
      };
    },

    name: function (r) {
      var p = S.st.p;
      return {
        html: stepHead(r) + "<h1>" + esc(P("appQName")) + "</h1>" +
          '<label class="field"><span class="field__label">' + esc(P("appFirst")) + '</span><input class="input" id="f-first" maxlength="50" autocomplete="given-name" placeholder="' + esc(P("appFirstPh")) + '" value="' + esc(p.first) + '"><div class="err" id="e-first" hidden></div></label>' +
          '<label class="field"><span class="field__label">' + esc(P("appLast")) + '</span><input class="input" id="f-last" maxlength="50" autocomplete="family-name" placeholder="' + esc(P("appLastPh")) + '" value="' + esc(p.last) + '"><div class="err" id="e-last" hidden></div></label>',
        footer: '<button class="btn" data-act="saveName">' + esc(P("btnContinue")) + "</button>",
        focus: p.first ? null : "f-first"
      };
    },

    phone: function (r) {
      return {
        html: stepHead(r) + "<h1>" + esc(P("appQPhone")) + '</h1><p class="sub">' + esc(P("appQPhoneSub")) + "</p>" +
          '<label class="field"><input class="input" id="f-phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="24" placeholder="+7 7__ ___ __ __" value="' + esc(S.st.p.phone) + '">' +
          '<div class="err" id="e-phone" hidden></div></label>',
        footer: '<button class="btn" data-act="savePhone">' + esc(P("btnContinue")) + "</button>",
        focus: S.st.p.phone ? null : "f-phone"
      };
    },

    age: function (r) {
      return {
        html: stepHead(r) + "<h1>" + esc(P("ageQ")) + '</h1><div class="opts opts--2">' +
          S.cat.AGES.map(function (a, i) {
            return opt("age", i, L(a), { pressed: S.st.p.age === i, chev: false, cls: "opt--center" + (i === S.cat.AGE_NONE ? " opt--ghost" : "") });
          }).join("") + "</div>"
      };
    },

    themes: function (r) {
      var cur = topicOf(S.st.p.topic);
      return {
        html: stepHead(r) + "<h1>" + esc(P("appQThemes")) + '</h1><p class="sub">' + esc(P("appQThemesSub")) + '</p><div class="opts">' +
          S.cat.THEMES.map(function (th, i) {
            return opt("theme", i, L(th), { icon: THEME_ICON[i], pressed: cur && cur.theme === th, desc: cur && cur.theme === th ? L(cur.item) : "" });
          }).join("") + "</div>"
      };
    },

    topics: function (r) {
      var th = S.cat.THEMES[r.arg];
      return {
        html: stepHead(r) + '<div class="step">' + esc(L(th)) + "</div><h1>" + esc(P("appQTopic")) + '</h1><div class="opts">' +
          th.items.map(function (it, i) { return opt("topic", r.arg + ":" + i, L(it), { pressed: S.st.p.topic === r.arg + ":" + i, chev: false }); }).join("") +
          opt("back", "", P("btnOtherThemes"), { cls: "opt--ghost" }) + "</div>"
      };
    },

    home: function () {
      var p = S.st.p;
      var fav = S.st.q.fav;
      var active = S.reqs ? S.reqs.filter(function (x) { return x.status === "proposed" || x.status === "answered"; }).length : 0;
      var favHtml = "";
      if (fav.length) {
        favHtml = "<h2>" + esc(P("favTitle").replace(/:$/, "")) + '</h2><div class="hscroll">' + fav.map(function (id) {
          var pr = S.profiles[id];
          if (!pr) return "";
          return '<button class="mini" data-act="profile" data-arg="' + esc(id) + '">' + avatar(pr) +
            '<div class="mini__name">' + esc(pr.name) + '</div><div class="mini__dir">' + esc(dirLabel(pr.dir)) + "</div></button>";
        }).join("") + "</div>";
      }
      return {
        html: '<div class="hello"><img src="mascot.png" alt=""><div><h1>' + esc(P("appHello", { name: p.first })) + '</h1><p class="sub" style="margin:0">' + esc(P("appHomeSub")) + "</p></div></div>" +
          '<button class="hero hero--orange" data-act="nav" data-arg="supportIntro"><div class="hero__title">' + esc(P("btnSupport")) + '</div><div class="hero__sub">' + esc(P("appSupportSub")) + '</div><span class="hero__icon">🤍</span></button>' +
          '<button class="hero hero--maroon" data-act="nav" data-arg="sections"><div class="hero__title">' + esc(P("btnFindSpec")) + '</div><div class="hero__sub">' + esc(P("appSearchSub")) + '</div><span class="hero__icon">🔎</span></button>' +
          '<div class="tiles"><button class="tile" data-act="nav" data-arg="reqs"><div class="tile__icon">' + ICON.list + '</div><div class="tile__title">' + esc(P("btnMyReqs")) + '</div><div class="tile__sub">' + esc(P("appReqsSub")) + "</div>" +
          (active ? '<span class="tile__badge">' + active + "</span>" : "") + "</button>" +
          '<button class="tile" data-act="nav" data-arg="settings"><div class="tile__icon">' + ICON.user + '</div><div class="tile__title">' + esc(P("btnSettings")) + '</div><div class="tile__sub">' + esc(P("appSettingsSub")) + "</div></button></div>" +
          favHtml
      };
    },

    supportIntro: function () {
      if (!supportAvailable()) {
        return {
          html: "<h1>" + esc(P("btnSupport")) + '</h1><div class="text-card">' + esc(P("supportNoCity")) + "</div>" +
            '<div class="btns"><button class="btn" data-act="nav" data-arg="sections">' + esc(P("btnGoSearch")) + '</button>' +
            '<button class="btn btn--ghost" data-act="edit" data-arg="city">' + esc(P("btnOtherCity")) + "</button></div>"
        };
      }
      return {
        html: "<h1>" + esc(P("btnSupport")) + '</h1><div class="text-card">' + esc(P("supportIntro")) + "</div>" +
          '<div class="btns"><button class="btn" data-act="nav" data-arg="supportTime">' + esc(P("btnRequestConsult")) + '</button>' +
          '<button class="btn btn--ghost" data-act="nav" data-arg="sections">' + esc(P("btnGoSearch")) + "</button></div>"
      };
    },

    supportTime: function () {
      var t = S.st.p.time && typeof S.st.p.time === "object" && S.st.timeValid ? S.st.p.time : null;
      var date = t ? t.date : "";
      var cur = t ? (t.time || "any") : "";
      return {
        html: "<h1>" + esc(P("appChooseDate")) + "</h1>" +
          '<div class="date-card"><input class="input date-input" id="f-date" type="date" min="' + S.cat.calendar.min + '" max="' + S.cat.calendar.max + '" value="' + esc(date) + '">' +
          '<div class="date-human" id="date-human">' + esc(date ? dayLabel(date) : "") + "</div></div>" +
          "<h2>" + esc(P("appChooseTime")) + '</h2><div class="slots">' +
          S.cat.CONTACT_SLOTS.map(function (h) { return '<button class="chip" data-act="slot" data-arg="' + h + '"' + (cur === h ? ' aria-pressed="true"' : "") + ">" + h + "</button>"; }).join("") +
          '</div><div class="chips" style="margin-top:8px"><button class="chip" data-act="slot" data-arg="any"' + (cur === "any" ? ' aria-pressed="true"' : "") + ">" + esc(P("btnAnyTime")) + "</button></div>" +
          '<p class="note">🕒 ' + esc(P("whenAt", { date: "", time: "" }).replace(/^[,\s(]+|\)$/g, "").replace(/^./, function (c) { return c.toUpperCase(); })) + " (UTC+5)</p>" +
          '<div class="err" id="e-time" hidden></div>',
        footer: '<button class="btn" data-act="saveTime">' + esc(P("btnContinue")) + "</button>",
        after: function () {
          var input = document.getElementById("f-date");
          input.addEventListener("change", function () { document.getElementById("date-human").textContent = dayLabel(input.value); });
          S.slot = cur || null;
        }
      };
    },

    reviewSupport: function () {
      var p = S.st.p;
      var list = [[P("lName"), fullName(p) || P("notSet"), "name"], [P("lCity"), cityLabel(p.city), "city"], [P("lPhone"), p.phone || P("notSet"), "phone"]];
      if (p.age != null && p.age !== S.cat.AGE_NONE) list.push([P("lAge"), ageLabel(p.age), "age"]);
      list.push([P("lTopic"), topicLabel(p.topic), "themes"], [P("lConsultLang"), P(S.lang === "kk" ? "langKk" : "langRu")],
        [P("lTime"), timeLabel(p.time), "supportTime"]);
      return {
        html: "<h1>" + esc(P("btnSupport")) + '</h1><p class="sub">' + esc(P("reviewSupport")) + "</p>" + rows(list, true) +
          '<p class="note">' + esc(P("consentNote")) + "</p>",
        footer: '<button class="btn" data-act="submit" data-arg="support">' + esc(P("btnSend")) + "</button>"
      };
    },

    done: function (r) {
      var req = r.arg;
      return {
        html: '<div class="done"><div class="done__check">' + ICON.check + "</div><h1>" + esc(P("appSent")) + '</h1><p class="sub">' +
          esc(P(req.kind === "support" ? "supportAccepted" : "specAccepted")) + "</p></div>" +
          '<div class="btns"><button class="btn" data-act="req" data-arg="' + esc(req.id) + '">' + esc(P("btnOpenReq")) + '</button>' +
          '<button class="btn btn--soft" data-act="nav" data-arg="sections">' + esc(P("btnContinueSearch")) + '</button>' +
          '<button class="btn btn--ghost" data-act="home">' + esc(P("btnMainMenu")) + "</button></div>"
      };
    },

    sections: function () {
      return {
        html: "<h1>" + esc(P("appQSections")) + '</h1><p class="sub">' + esc(P("appQSectionsSub")) + '</p><div class="grid2">' +
          S.cat.SECTIONS.map(function (sec, i) {
            return '<button class="sec" data-act="sec" data-arg="' + i + '"><span class="sec__icon">' + SECTION_ICON[i] + '</span><span class="sec__name">' + esc(L(sec)) + "</span></button>";
          }).join("") + '</div><div class="opts" style="margin-top:12px">' + opt("nav", "unknown", P("btnDontKnow"), { icon: "🤔", cls: "opt--ghost" }) + "</div>"
      };
    },

    unknown: function () {
      return {
        html: "<h1>" + esc(P("btnDontKnow")) + '</h1><p class="sub">' + esc(P("unknownIntro")) + '</p><div class="opts">' +
          S.cat.SECTIONS.map(function (sec, i) { return opt("sec", i, L(sec), { icon: SECTION_ICON[i], desc: L(sec.desc) }); }).join("") +
          opt("nav", "supportIntro", P("btnSupportSelf"), { icon: "🤍", cls: "opt--ghost" }) + "</div>"
      };
    },

    dirs: function (r) {
      var sec = S.cat.SECTIONS[r.arg];
      return {
        html: '<div class="step">' + SECTION_ICON[r.arg] + " " + esc(L(sec)) + "</div><h1>" + esc(P("dirsQ", { section: "" }).replace(/^\s+/, "")) + '</h1><div class="opts">' +
          sec.dirs.map(function (d, i) { return opt("dir", r.arg + ":" + i, L(d), { pressed: S.st.q.dir === r.arg + ":" + i }); }).join("") + "</div>"
      };
    },

    filters: function () {
      var q = S.st.q, p = S.st.p;
      var complete = q.dir && q.clang != null && q.fmt != null && q.budget != null;
      var custom = q.budget != null && q.budget > 0 && S.cat.BUDGETS.indexOf(q.budget) === -1;
      var seg = function (act, list, cur) {
        return '<div class="seg">' + list.map(function (x, i) {
          return '<button data-act="' + act + '" data-arg="' + i + '"' + (cur === i ? ' aria-pressed="true"' : "") + ">" + esc(L(x)) + "</button>";
        }).join("") + "</div>";
      };
      return {
        html: "<h1>" + esc(P("appFilters")) + "</h1>" +
          '<div class="dirhead"><div><div class="dirhead__label">' + esc(P("lDir")) + '</div><div class="dirhead__name">' + esc(dirLabel(q.dir)) + "</div></div>" +
          '<button class="btn btn--soft btn--sm" data-act="edit" data-arg="sections">' + esc(P("appEdit")) + "</button></div>" +
          "<h2>" + esc(P("lClassLang")) + "</h2>" + seg("clang", S.cat.CLASS_LANGS, q.clang) +
          "<h2>" + esc(P("lFormat")) + "</h2>" + seg("fmt", S.cat.FORMATS, q.fmt) +
          "<h2>" + esc(P("lBudget")) + '</h2><div class="chips">' +
          S.cat.BUDGETS.map(function (b) { return '<button class="chip" data-act="budget" data-arg="' + b + '"' + (q.budget === b ? ' aria-pressed="true"' : "") + ">" + esc(budgetLabel(b)) + "</button>"; }).join("") +
          '</div><div class="custom"><input class="input" id="f-budget" inputmode="numeric" placeholder="' + esc(P("appBudgetCustom")) + '" value="' + (custom ? q.budget : "") + '">' +
          '<button class="btn btn--soft btn--sm" data-act="budgetCustom">' + esc(P("appApply")) + '</button></div><div class="err" id="e-budget" hidden></div>' +
          "<h2>" + esc(P("lAge")) + '</h2><div class="chips">' +
          S.cat.AGES.map(function (a, i) { return '<button class="chip" data-act="fAge" data-arg="' + i + '"' + (p.age === i ? ' aria-pressed="true"' : "") + ">" + esc(L(a)) + "</button>"; }).join("") +
          "</div><h2>" + esc(P("lCity")) + '</h2><div class="chips">' +
          S.cat.CITIES.map(function (c) { return '<button class="chip" data-act="fCity" data-arg="' + c.id + '"' + (p.city && p.city.id === c.id ? ' aria-pressed="true"' : "") + ">" + esc(L(c)) + "</button>"; }).join("") +
          '<button class="chip" data-act="edit" data-arg="cityOther"' + (p.city && p.city.name ? ' aria-pressed="true"' : "") + ">" + esc(p.city && p.city.name ? p.city.name : P("cityOther")) + "</button></div>",
        footer: '<button class="btn" data-act="showResults"' + (complete ? "" : " disabled") + ">" +
          esc(complete && S.count != null ? P("appShowN", { n: S.count }) : P("appShow")) + "</button>",
        after: function () { if (complete && S.count == null) refreshCount(); }
      };
    },

    results: function () {
      if (!S.results) {
        return api("search").then(function (r) {
          if (r.missing) { S.stack.pop(); go(r.missing === "sections" ? "sections" : "filters"); return null; }
          S.results = r.list; S.inDir = r.inDir; S.count = r.list.length;
          r.list.forEach(function (pr) { S.profiles[pr.id] = pr; });
          return VIEWS.results();
        });
      }
      var q = S.st.q;
      var head = '<div class="summary"><span class="tag">' + esc(dirLabel(q.dir)) + '</span><span class="tag">' + esc(L(S.cat.CLASS_LANGS[q.clang])) +
        '</span><span class="tag">' + esc(L(S.cat.FORMATS[q.fmt])) + '</span><span class="tag">' + esc(budgetLabel(q.budget)) +
        '</span><button class="link" data-act="nav" data-arg="filters">' + esc(P("appEdit")) + "</button></div>";
      if (!S.results.length) {
        var onlineBtn = S.inDir && S.cat.FORMATS[q.fmt].id !== "on"
          ? '<button class="btn btn--soft" data-act="seeOnline">' + esc(P("btnSeeOnline")) + "</button>" : "";
        return {
          html: "<h1>" + esc(P("appFound", { n: 0 })) + "</h1>" + head + '<div class="text-card">' + esc(P(S.inDir ? "noMatch" : "noProfiles")) + "</div>" +
            '<div class="btns">' + onlineBtn + '<button class="btn" data-act="nav" data-arg="filters">' + esc(P("btnChangeCond")) + '</button>' +
            '<button class="btn btn--ghost" data-act="nav" data-arg="sections">' + esc(P("btnOtherDirs")) + '</button>' +
            '<button class="btn btn--ghost" data-act="nav" data-arg="supportIntro">' + esc(P("btnAboutSupport")) + "</button></div>"
        };
      }
      var cmpN = S.st.q.cmp.length;
      return {
        html: "<h1>" + esc(P("appFound", { n: S.results.length })) + "</h1>" + head + '<div class="list">' + S.results.map(specCard).join("") +
          '</div><p class="note"><span class="demo">' + esc(P("appDemo")) + "</span></p>",
        footer: cmpN ? '<div class="cmpbar"><button class="btn btn--soft" data-act="nav" data-arg="compare">' + ICON.cmp + " " + esc(P("appCompareBar", { n: cmpN })) + "</button></div>" : ""
      };
    },

    profile: function (r) {
      var pr = S.profiles[r.arg];
      if (!pr) return loadProfiles([r.arg]).then(function () { return S.profiles[r.arg] ? VIEWS.profile(r) : { html: '<div class="text-card">' + esc(P("appNotFound")) + "</div>" }; });
      var list = [];
      if (pr.city) list.push([P("lCity"), cityLabel({ id: pr.city })]);
      list.push([P("lFormat"), fmtList(pr).join(", ")], [P("lLangs"), langList(pr).join(", ")], [P("lAges"), agesText(pr)], [P("lPrice"), priceLabel(pr)]);
      var quals = (pr.quals || []).map(function (x) { return "<li>" + esc(x.title ? L(x.title) : "") + "</li>"; }).join("");
      var can = pr.availability === "available";
      return {
        html: '<div class="prof">' + avatar(pr) + '<div class="prof__name">' + esc(pr.name) + '</div><div class="prof__dir">' + esc(dirLabel(pr.dir)) + "</div>" + availBadge(pr) +
          '<div class="prof__actions"><button class="icon-btn" data-act="fav" data-arg="' + esc(pr.id) + '" aria-pressed="' + isFav(pr.id) + '" aria-label="' + esc(P("btnFav")) + '">' + (isFav(pr.id) ? ICON.heart : ICON.heartO) + "</button>" +
          '<button class="icon-btn icon-btn--cmp" data-act="cmp" data-arg="' + esc(pr.id) + '" aria-pressed="' + isCmp(pr.id) + '" aria-label="' + esc(P("btnCmp")) + '">' + ICON.cmp + "</button></div></div>" +
          "<h2>" + esc(P("appAbout")) + "</h2>" + rows(list) +
          (pr.about ? '<div class="text-card" style="margin-top:12px">' + esc(L(pr.about)) + "</div>" : "") +
          (pr.exp || quals ? '<div class="text-card" style="margin-top:12px">' + (pr.exp ? "<b>" + esc(expLabel(pr.exp)) + "</b>" : "") +
            (quals ? '<p class="note" style="margin-top:8px">' + esc(P("lQual")) + ':</p><ul class="quals">' + quals + "</ul>" : "") + "</div>" : "") +
          '<div class="btns"><button class="btn btn--ghost" data-act="site" data-arg="' + esc(pr.id) + '">' + esc(P("appFullProfile")) + " " + ICON.ext + "</button></div>" +
          '<p class="note"><span class="demo">' + esc(P("demoMark")) + "</span></p>",
        footer: can ? '<button class="btn" data-act="prepare" data-arg="' + esc(pr.id) + '">' + esc(P("btnPrepare")) + "</button>" : ""
      };
    },

    compare: function () {
      var ids = S.st.q.cmp;
      var missing = ids.filter(function (id) { return !S.profiles[id]; });
      if (missing.length) return loadProfiles(missing).then(function () { return VIEWS.compare(); });
      var col = function (pr) {
        var kv = function (k, v) { return '<div class="cmp__k">' + esc(k) + '</div><div class="cmp__v">' + esc(v) + "</div>"; };
        return '<div class="cmp__col">' + avatar(pr) + '<div class="spec__name">' + esc(pr.name) + '</div><div class="spec__dir">' + esc(dirLabel(pr.dir)) + "</div>" +
          kv(P("lPrice"), priceLabel(pr)) + kv(P("lFormat"), fmtList(pr).join(", ")) + kv(P("lLangs"), langList(pr).join(", ")) +
          (pr.city ? kv(P("lCity"), cityLabel({ id: pr.city })) : "") + kv(P("lAges"), agesText(pr)) +
          '<div class="cmp__k">&nbsp;</div>' + availBadge(pr) +
          '<button class="btn btn--sm" style="width:100%" data-act="profile" data-arg="' + esc(pr.id) + '">' + esc(P("btnMore")) + '</button>' +
          '<button class="btn btn--ghost btn--sm" style="width:100%;margin-top:8px" data-act="cmp" data-arg="' + esc(pr.id) + '">' + esc(P("btnRemove", { name: "" }).replace(/[:\s]+$/, "")) + "</button></div>";
      };
      var cols = ids.map(function (id) { return S.profiles[id]; }).filter(Boolean).map(col);
      while (cols.length < 2) cols.push('<div class="empty-slot">' + esc(P("cmpOne")) + "</div>");
      return {
        html: "<h1>" + esc(P("cmpTitle")) + '</h1><div class="cmp">' + cols.join("") + "</div>",
        footer: '<button class="btn btn--soft" data-act="toResults">' + esc(P("btnBackResults")) + "</button>"
      };
    },

    reviewSpec: function (r) {
      var pr = S.profiles[r.arg];
      if (!pr) return loadProfiles([r.arg]).then(function () { return VIEWS.reviewSpec(r); });
      var p = S.st.p, q = S.st.q;
      var list = [[P("lSpecialist"), pr.name + " — " + dirLabel(pr.dir)], [P("lName"), fullName(p) || P("notSet"), "name"],
        [P("lCity"), cityLabel(p.city)], [P("lPhone"), p.phone || P("notSet"), "phone"], [P("lAge"), ageLabel(p.age)],
        [P("lClassLang"), q.clang != null ? L(S.cat.CLASS_LANGS[q.clang]) : P("notSet")],
        [P("lFormat"), q.fmt != null ? L(S.cat.FORMATS[q.fmt]) : P("notSet")], [P("lBudget"), budgetLabel(q.budget)]];
      return {
        html: "<h1>" + esc(P("btnPrepare")) + '</h1><p class="sub">' + esc(P("reviewSpec")) + "</p>" + rows(list, true) +
          '<div class="callout"><div class="callout__k">' + esc(P("specPriceNote", { price: "" }).replace(/[:\s]+$/, "")) + '</div><div class="callout__v">' + esc(priceLabel(pr)) + "</div></div>" +
          '<div class="btns"><button class="btn btn--ghost" data-act="nav" data-arg="filters">' + esc(P("btnEdSearch")) + "</button></div>" +
          '<p class="note">' + esc(P("consentNote")) + "</p>",
        footer: '<button class="btn" data-act="submit" data-arg="spec:' + esc(pr.id) + '">' + esc(P("btnSend")) + "</button>"
      };
    },

    mismatch: function () {
      return {
        html: '<div class="text-card" style="margin-top:12px">' + esc(P("specMismatch")) + "</div>" +
          '<div class="btns"><button class="btn" data-act="nav" data-arg="filters">' + esc(P("btnToConditions")) + '</button>' +
          '<button class="btn btn--ghost" data-act="toResults">' + esc(P("btnOtherSpec")) + "</button></div>"
      };
    },

    reqs: function () {
      return api("requests").then(function (r) {
        S.reqs = r.list;
        if (!r.list.length) {
          return {
            html: "<h1>" + esc(P("btnMyReqs")) + '</h1><div class="text-card">' + esc(P("myReqsEmpty")) + "</div>" +
              '<div class="btns"><button class="btn" data-act="home">' + esc(P("btnChooseNext")) + "</button></div>"
          };
        }
        return {
          html: "<h1>" + esc(P("btnMyReqs")) + '</h1><div class="list">' + r.list.map(function (x) {
            return '<button class="req" data-act="req" data-arg="' + esc(x.id) + '"><div class="req__label">' + esc(x.label) + '</div>' +
              '<div class="req__meta"><span>' + esc(x.created) + '</span><span class="st st--' + esc(x.status) + '">' + esc(x.statusLabel) + "</span></div></button>";
          }).join("") + "</div>"
        };
      });
    },

    req: function (r) {
      return api("request", { id: r.arg }).then(function (res) {
        if (!res.request) return { html: '<div class="text-card">' + esc(P("myReqsEmpty")) + "</div>" };
        return reqView(res.request, r.flash);
      });
    },

    settings: function () {
      var p = S.st.p;
      var list = [[P("lName"), fullName(p) || P("notSet"), "name"], [P("lPhone"), p.phone || P("notSet"), "phone"],
        [P("lCity"), cityLabel(p.city), "city"], [P("lAge"), ageLabel(p.age), "age"], [P("lTopic"), topicLabel(p.topic), "themes"]];
      return {
        html: "<h1>" + esc(P("btnSettings")) + '</h1><p class="sub">' + esc(P("settingsQ")) + "</p>" + rows(list, true) +
          "<h2>" + esc(P("appLanguage")) + '</h2><div class="seg"><button data-act="setLang" data-arg="kk"' + (S.lang === "kk" ? ' aria-pressed="true"' : "") + '>Қазақша</button>' +
          '<button data-act="setLang" data-arg="ru"' + (S.lang === "ru" ? ' aria-pressed="true"' : "") + ">Русский</button></div>" +
          '<h2>' + esc(P("appNotifications")) + '</h2><div class="rows"><div class="row"><span class="row__k" style="max-width:none">' +
          esc(P(S.st.notify ? "btnNotifyOn" : "btnNotifyOff")) + '</span><label class="switch"><input type="checkbox" id="f-notify"' + (S.st.notify ? " checked" : "") +
          '><span></span></label></div></div>',
        after: function () {
          document.getElementById("f-notify").addEventListener("change", function (e) {
            save({ notify: e.target.checked }).then(render).catch(fail);
          });
        }
      };
    }
  };

  function specCard(pr) {
    var chips = fmtList(pr).concat(langList(pr)).map(function (x) { return '<span class="tagline">' + esc(x) + "</span>"; }).join("");
    if (pr.city) chips = '<span class="tagline">📍 ' + esc(cityLabel({ id: pr.city })) + "</span>" + chips;
    return '<article class="spec" data-act="profile" data-arg="' + esc(pr.id) + '">' + avatar(pr) +
      '<div class="spec__main"><div class="spec__name">' + esc(pr.name) + '</div><div class="spec__dir">' + esc(dirLabel(pr.dir)) + " · " + esc(agesShort(pr)) + "</div>" +
      '<div class="chips">' + chips + '</div><div class="spec__foot"><span class="price">' + esc(priceLabel(pr)) + "</span>" + availBadge(pr) + "</div></div>" +
      '<div class="spec__actions"><button class="icon-btn" data-act="fav" data-arg="' + esc(pr.id) + '" aria-pressed="' + isFav(pr.id) + '" aria-label="' + esc(P("btnFav")) + '">' + (isFav(pr.id) ? ICON.heart : ICON.heartO) + "</button>" +
      '<button class="icon-btn icon-btn--cmp" data-act="cmp" data-arg="' + esc(pr.id) + '" aria-pressed="' + isCmp(pr.id) + '" aria-label="' + esc(P("btnCmp")) + '">' + ICON.cmp + "</button></div></article>";
  }

  function reqView(x, flash) {
    var box = "";
    if (x.status === "proposed" && x.proposal) box = '<div class="callout"><div class="callout__k">' + esc(P("appProposal")) + '</div><div class="callout__v">' + esc(x.proposal) + "</div></div>";
    if (x.status === "confirmed" && x.proposal) box = '<div class="callout"><div class="callout__k">' + esc(P("appMeeting")) + '</div><div class="callout__v">' + esc(x.proposal) + "</div></div>";
    if (x.status === "answered" && x.answer) box = '<div class="callout"><div class="callout__k">' + esc(P("appAnswer")) + '</div><div class="callout__v" style="font-size:16px">' + esc(x.answer) + "</div></div>";
    var actions = "";
    if (x.status === "proposed") {
      actions += '<button class="btn" data-act="respond" data-arg="ok:' + esc(x.id) + '">' + esc(P("btnFits")) + '</button>' +
        '<button class="btn btn--soft" data-act="respond" data-arg="no:' + esc(x.id) + '">' + esc(P("btnOtherTime")) + "</button>";
    }
    if (x.status !== "cancelled") actions += '<button class="btn btn--danger" data-act="cancelReq" data-arg="' + esc(x.id) + '">' + esc(P("btnCancelReq")) + "</button>";
    return {
      html: (flash ? '<div class="text-card" style="margin-bottom:12px"><b>' + esc(flash) + "</b></div>" : "") +
        "<h1>" + esc(x.label) + '</h1><div class="summary"><span class="st st--' + esc(x.status) + '">' + esc(x.statusLabel) + '</span><span class="tag">' + esc(x.created) + "</span></div>" +
        '<div class="rows"><div class="row"><span class="row__k">' + esc(P("reqRecipient").split(":")[0]) + '</span><span class="row__v">' + esc((P("reqRecipient").split(":")[1] || "").trim()) + "</span></div></div>" +
        box + '<details class="more"><summary>' + esc(P("btnShowInfo")) + "</summary>" + rows(x.lines) + "</details>" +
        (actions ? '<div class="btns">' + actions + "</div>" : "")
    };
  }

  // ---------- Отрисовка ----------
  function header() {
    var showBack = !tg || !tg.BackButton || !initData;
    return '<header class="top">' + (showBack && S.stack.length > 1 ? '<button class="top__back" data-act="back" aria-label="←">' + ICON.back + "</button>" : "") +
      '<img class="top__mascot" src="mascot.png" alt=""><span class="top__brand">I-Help</span><span class="top__spacer"></span>' +
      (S.st && S.st.lang ? '<div class="lang-pill"><button data-act="setLang" data-arg="kk" aria-pressed="' + (S.lang === "kk") + '">ҚАЗ</button>' +
        '<button data-act="setLang" data-arg="ru" aria-pressed="' + (S.lang === "ru") + '">РУС</button></div>' : "") + "</header>";
  }

  function paint(view) {
    document.documentElement.lang = S.lang === "kk" ? "kk" : "ru";
    $app.innerHTML = header() + '<main class="page">' + view.html + "</main>" + (view.footer ? '<div class="bottom"><div>' + view.footer + "</div></div>" : "");
    window.scrollTo(0, 0);
    if (view.focus) { var f = document.getElementById(view.focus); if (f) f.focus(); }
    if (view.after) view.after();
    if (tg && tg.BackButton && initData) {
      if (S.stack.length > 1) tg.BackButton.show(); else tg.BackButton.hide();
    }
  }

  function render() {
    var id = ++S.renderId;
    var r = top();
    var out;
    try { out = VIEWS[r.name](r); } catch (e) { return fail(e); }
    if (out && typeof out.then === "function") {
      var slow = setTimeout(function () {
        if (id === S.renderId) $app.innerHTML = header() + '<main class="page"><div class="splash" style="min-height:50vh"><div class="spinner"></div></div></main>';
      }, 150);
      out.then(function (view) {
        clearTimeout(slow);
        if (view && id === S.renderId) paint(view);
      }).catch(function (e) { clearTimeout(slow); fail(e); });
    } else if (out) {
      paint(out);
    }
  }

  function loadProfiles(ids) {
    return api("profiles", { ids: ids }).then(function (r) { r.list.forEach(function (pr) { S.profiles[pr.id] = pr; }); });
  }
  function refreshCount() {
    var q = S.st.q;
    if (!(q.dir && q.clang != null && q.fmt != null && q.budget != null)) { S.count = null; return; }
    api("search").then(function (r) {
      S.results = r.list; S.inDir = r.inDir; S.count = r.list.length;
      r.list.forEach(function (pr) { S.profiles[pr.id] = pr; });
      if (top().name === "filters") render();
    }).catch(fail);
  }
  // Условия поиска изменились — результаты и счётчик пересчитать.
  function conditionsChanged() { S.results = null; S.count = null; }

  function showErrors(errors, map) {
    var any = false;
    Object.keys(map).forEach(function (field) {
      var box = document.getElementById("e-" + map[field]);
      var input = document.getElementById("f-" + map[field]);
      if (!box) return;
      if (errors[field]) { box.textContent = String(errors[field]).replace(/<[^>]+>/g, ""); box.hidden = false; any = true; if (input) input.setAttribute("aria-invalid", "true"); }
      else { box.hidden = true; if (input) input.removeAttribute("aria-invalid"); }
    });
    if (any) haptic("err");
    return any;
  }

  // ---------- Действия ----------
  var busy = false;
  function guard(fn) {
    return function (arg, el) {
      if (busy) return;
      busy = true;
      if (el && el.tagName === "BUTTON") el.disabled = true;
      Promise.resolve().then(function () { return fn(arg, el); })
        .catch(fail)
        .then(function () { busy = false; if (el && el.isConnected) el.disabled = false; });
    };
  }

  var ACT = {
    back: back,
    home: function () { reset("home"); },
    nav: function (name) {
      haptic();
      if (name === "filters" && top().name === "results") return go("filters");
      go(name);
    },
    edit: function (field) { haptic(); go(field === "cityOther" ? "cityOther" : field, null, top().name); },
    setLang: guard(function (lang) {
      haptic();
      var first = !S.st.lang;
      return save({ lang: lang }).then(function () {
        if (first) reset(firstStep()); else render();
      });
    }),
    city: guard(function (id) {
      haptic();
      return save({ p: { city: { id: id } } }).then(function () { conditionsChanged(); finish("name"); });
    }),
    cityOther: function () { go("cityOther", null, top().ret); },
    saveCity: guard(function () {
      var name = document.getElementById("f-city").value;
      return save({ p: { city: { name: name } } }).then(function (errs) {
        if (showErrors(errs, { city: "city" })) return;
        conditionsChanged();
        var r = top();
        if (r.ret) return backTo(r.ret);
        // из шага «Город» анкеты: убрать экран выбора города из истории
        S.stack.pop();
        finish("name");
      });
    }),
    saveName: guard(function () {
      return save({ p: { first: document.getElementById("f-first").value, last: document.getElementById("f-last").value } }).then(function (errs) {
        if (showErrors(errs, { first: "first", last: "last" })) return;
        finish("phone");
      });
    }),
    savePhone: guard(function () {
      return save({ p: { phone: document.getElementById("f-phone").value } }).then(function (errs) {
        if (showErrors(errs, { phone: "phone" })) return;
        finish("age");
      });
    }),
    age: guard(function (i) {
      haptic();
      return save({ p: { age: Number(i) } }).then(function () { conditionsChanged(); finish("themes"); });
    }),
    theme: function (i) { haptic(); go("topics", Number(i), top().ret); },
    topic: guard(function (key) {
      haptic();
      return save({ p: { topic: key } }).then(function () {
        var r = top();
        if (r.ret) return backTo(r.ret);
        reset("home");
      });
    }),
    slot: function (v, el) {
      haptic();
      S.slot = v;
      Array.prototype.forEach.call(document.querySelectorAll('[data-act="slot"]'), function (b) { b.setAttribute("aria-pressed", b === el ? "true" : "false"); });
    },
    saveTime: guard(function () {
      var date = document.getElementById("f-date").value;
      var box = document.getElementById("e-time");
      if (!date || !S.slot) { box.textContent = P("appTimeErr"); box.hidden = false; haptic("err"); return; }
      return save({ p: { time: { date: date, time: S.slot === "any" ? null : S.slot } } }).then(function (errs) {
        if (errs.time) { box.textContent = P("appTimeErr"); box.hidden = false; haptic("err"); return; }
        var r = top();
        if (r.ret) return backTo(r.ret);
        go("reviewSupport");
      });
    }),
    sec: function (i) { haptic(); go("dirs", Number(i), top().ret); },
    dir: guard(function (key) {
      haptic();
      return save({ q: { dir: key } }).then(function () {
        conditionsChanged();
        // из фильтров (через «Изменить»): вернуться к ним; иначе — к фильтрам нового поиска
        if (S.stack.some(function (x) { return x.name === "filters"; })) return backTo("filters");
        while (S.stack.length > 1 && top().name !== "home") S.stack.pop();
        go("filters");
      });
    }),
    clang: guard(function (i) { haptic(); return save({ q: { clang: Number(i) } }).then(function () { conditionsChanged(); render(); }); }),
    fmt: guard(function (i) { haptic(); return save({ q: { fmt: Number(i) } }).then(function () { conditionsChanged(); render(); }); }),
    budget: guard(function (b) { haptic(); return save({ q: { budget: Number(b) } }).then(function () { conditionsChanged(); render(); }); }),
    budgetCustom: guard(function () {
      var raw = document.getElementById("f-budget").value.replace(/[\s ₸]/g, "");
      var n = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!(n >= 0 && n <= S.cat.BUDGET_MAX)) { showErrors({ budget: P("budgetErr") }, { budget: "budget" }); return; }
      return save({ q: { budget: n } }).then(function (errs) {
        if (showErrors(errs, { budget: "budget" })) return;
        conditionsChanged(); render();
      });
    }),
    fAge: guard(function (i) { haptic(); return save({ p: { age: Number(i) } }).then(function () { conditionsChanged(); render(); }); }),
    fCity: guard(function (id) { haptic(); return save({ p: { city: { id: id } } }).then(function () { conditionsChanged(); render(); }); }),
    showResults: function () { haptic(); if (top().name === "filters" && S.stack.length > 1 && S.stack[S.stack.length - 2].name === "results") return back(); go("results"); },
    seeOnline: guard(function () {
      var on = S.cat.FORMATS.map(function (f) { return f.id; }).indexOf("on");
      return save({ q: { fmt: on } }).then(function () { conditionsChanged(); go("filters"); });
    }),
    toResults: function () { if (S.stack.some(function (x) { return x.name === "results"; })) backTo("results"); else go("results"); },
    profile: function (id) { haptic(); go("profile", id); },
    fav: guard(function (id) {
      haptic();
      var fav = S.st.q.fav.slice();
      var at = fav.indexOf(id);
      if (at !== -1) fav.splice(at, 1); else fav.push(id);
      return save({ q: { fav: fav } }).then(render);
    }),
    cmp: guard(function (id) {
      var cmp = S.st.q.cmp.slice();
      var at = cmp.indexOf(id);
      if (at !== -1) cmp.splice(at, 1);
      else if (cmp.length >= 2) { haptic("err"); toast(P("cmpFull")); return; }
      else cmp.push(id);
      haptic();
      return save({ q: { cmp: cmp } }).then(render);
    }),
    site: function (id) {
      var base = new URL(ENV.SPECIALIST_PAGE || "../specialist.html", location.href);
      base.searchParams.set("id", id);
      base.searchParams.set("lang", S.lang);
      if (tg && tg.openLink && initData) tg.openLink(base.toString()); else window.open(base.toString(), "_blank", "noopener");
    },
    prepare: function (id) { haptic(); go("reviewSpec", id); },
    submit: guard(function (arg) {
      var kind = arg.indexOf("spec:") === 0 ? "spec" : "support";
      var specId = kind === "spec" ? arg.slice(5) : null;
      var review = kind === "spec" ? "reviewSpec" : "reviewSupport";
      return api("submit", { kind: kind, specId: specId }).then(function (r) {
        if (r.created) {
          haptic("ok");
          S.reqs = null;
          S.stack = [{ name: "home" }, { name: "done", arg: r.created }];
          return render();
        }
        if (r.existing) return go("req", r.existing);
        if (r.missing) { toast(P("missingField")); return go(r.missing, null, review); }
        if (r.needTime) return go("supportTime", null, review);
        if (r.noSupport) return go("supportIntro");
        if (r.mismatch || r.noProfile) return go("mismatch");
        haptic("err");
        toast(P("sendFail"));
      });
    }),
    req: function (id) { haptic(); go("req", id); },
    respond: guard(function (arg) {
      var ok = arg.indexOf("ok:") === 0, id = arg.slice(3);
      return api("respond", { id: id, ok: ok }).then(function (r) {
        haptic(r.request ? "ok" : "err");
        S.reqs = null;
        top().flash = r.message || null;
        render();
      });
    }),
    cancelReq: function (id, el) {
      var run = guard(function () {
        return api("cancel", { id: id }).then(function (r) {
          if (r.error) { haptic("err"); return toast(r.error); }
          haptic("ok");
          S.reqs = null;
          top().flash = r.message || null;
          render();
        });
      });
      var text = P("appCancelConfirm");
      if (tg && tg.showConfirm && initData) tg.showConfirm(text, function (yes) { if (yes) run(id, el); });
      else if (window.confirm(text)) run(id, el);
    }
  };

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    var fn = ACT[el.getAttribute("data-act")];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn(el.getAttribute("data-arg"), el, e);
  });
  // Enter в поле ввода — как кнопка «Продолжить».
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
    var btn = document.querySelector(".bottom .btn, .custom .btn");
    if (e.target.id === "f-budget") btn = document.querySelector('[data-act="budgetCustom"]');
    if (btn) { e.preventDefault(); btn.click(); }
  });

  // ---------- Запуск ----------
  function applyTheme() {
    var dark = tg && tg.colorScheme === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try {
      if (tg && tg.setHeaderColor) tg.setHeaderColor(dark ? "#1C1311" : "#FCF4DF");
      if (tg && tg.setBackgroundColor) tg.setBackgroundColor(dark ? "#1C1311" : "#FCF4DF");
    } catch (e) { /* старый клиент */ }
  }

  function boot() {
    if (tg) {
      tg.ready();
      if (tg.expand) tg.expand();
      applyTheme();
      if (tg.onEvent) tg.onEvent("themeChanged", applyTheme);
      if (tg.BackButton) tg.BackButton.onClick(back);
    }
    if (!initData) {
      $app.innerHTML = '<div class="splash"><img src="mascot.png" alt="" width="96" height="120"><p class="sub" style="text-align:center;max-width:300px">' +
        "Откройте это приложение из бота I-Help в Telegram.<br>Бұл қосымшаны Telegram-дағы I-Help ботынан ашыңыз." +
        '</p><a class="btn" style="max-width:280px" href="' + esc(ENV.BOT_URL || "https://t.me/") + '">I-Help</a></div>';
      return;
    }
    api("boot").then(function (r) {
      S.cat = r.catalog;
      S.st = r.state;
      S.lang = r.state.lang || r.state.suggestedLang || "ru";
      var first = firstStep();
      if (first !== "home") return reset(first);
      S.stack = [{ name: "home" }];
      var req = params.get("req");
      if (req) S.stack.push({ name: "req", arg: req });
      render();
      // избранное и счётчик обращений для главной — в фоне
      Promise.all([
        S.st.q.fav.length ? loadProfiles(S.st.q.fav) : null,
        api("requests").then(function (x) { S.reqs = x.list; })
      ]).then(function () { if (top().name === "home") render(); }).catch(function () {});
    }).catch(function (e) {
      $app.innerHTML = '<div class="splash"><img src="mascot.png" alt="" width="96" height="120"><p class="sub" style="text-align:center;max-width:300px">' +
        (e && e.auth ? "Откройте это приложение из бота I-Help в Telegram." : "Не удалось загрузить. Попробуйте ещё раз.") + "</p></div>";
    });
  }

  boot();
})();
