// Карточка специалиста с отзывами родителей: specialist.html?id=p17[&lang=kk].
// Ссылка ведёт сюда из карточки специалиста в Telegram-боте. Данные — Supabase REST по anon key
// (опубликованные профили и отзывы читать может кто угодно). Демо-профили и отзывы вымышлены — это видно на странице.
(function () {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var params = new URLSearchParams(location.search);
  var id = (params.get("id") || "").trim().slice(0, 40);
  var root = document.getElementById("spec-root");
  var data = null; // { spec, reviews } | { error }

  // Коды — как в каталоге бота (supabase/functions/_shared/catalog.mjs).
  var DIRS = {
    logoped: ["Логопед", "Логопед"], spec_pedagog: ["Специальный педагог", "Арнайы педагог"],
    surdopedagog: ["Сурдопедагог", "Сурдопедагог"], tiflopedagog: ["Тифлопедагог", "Тифлопедагог"],
    child_psychologist: ["Детский психолог", "Балалар психологы"], neuropsychologist: ["Нейропсихолог", "Нейропсихолог"],
    child_psychiatrist: ["Детский психиатр", "Балалар психиатры"], pediatrician: ["Педиатр", "Педиатр"],
    child_neurologist: ["Детский невролог", "Балалар неврологы"], geneticist: ["Врач-генетик", "Генетик дәрігер"],
    orthopedist: ["Травматолог-ортопед", "Травматолог-ортопед"], rehabilitologist: ["Врач-реабилитолог", "Оңалту дәрігері"],
    lfk_instructor: ["Инструктор ЛФК", "ЕДШ нұсқаушысы"], ergotherapist: ["Эрготерапевт", "Эрготерапевт"],
    ophthalmologist: ["Офтальмолог", "Офтальмолог"], ent: ["Оториноларинголог (ЛОР)", "Оториноларинголог (ЛОР)"],
    audiologist: ["Сурдолог", "Сурдолог"], gastroenterologist: ["Гастроэнтеролог", "Гастроэнтеролог"],
    endocrinologist: ["Эндокринолог", "Эндокринолог"], dietitian: ["Врач-диетолог", "Диетолог дәрігер"]
  };
  var CITIES = { almaty: ["Алматы", "Алматы"], astana: ["Астана", "Астана"], oskemen: ["Усть-Каменогорск", "Өскемен"],
    shymkent: ["Шымкент", "Шымкент"], kostanay: ["Костанай", "Қостанай"] };
  var AGES = { "0-2": ["0–2 года", "0–2 жас"], "3-5": ["3–5 лет", "3–5 жас"], "6-9": ["6–9 лет", "6–9 жас"],
    "10-13": ["10–13 лет", "10–13 жас"], "14-17": ["14–17 лет", "14–17 жас"], "18+": ["18 лет и старше", "18 жас және одан үлкен"] };
  var FORMATS = { off: ["очно", "бетпе-бет"], on: ["онлайн", "онлайн"] };
  var LANGS = { kk: ["казахский", "қазақ тілі"], ru: ["русский", "орыс тілі"] };
  var MONTHS = {
    ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
    kk: ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"]
  };
  var T = {
    ru: {
      kicker: "Карточка специалиста", loading: "Загрузка…", notFound: "Специалист не найден. Возможно, карточка снята с публикации.",
      noConfig: "Сайт не подключён к базе: не заданы адрес и ключ Supabase (config.js).", error: "Не удалось загрузить карточку. Попробуйте обновить страницу.",
      city: "Город", format: "Формат", langs: "Языки занятий", ages: "Возраст детей", price: "Стоимость", exp: "Опыт работы",
      priceUnknown: "не указана", free: "бесплатно", perMin: "{price} за {min} мин",
      av_available: "Принимает новых", av_waitlist: "Лист ожидания", av_unknown: "Нет данных о записи",
      about: "О специалисте", quals: "Квалификация", qualsNote: "со слов специалиста, документы не проверялись",
      reviews: "Отзывы родителей", noReviews: "Отзывов пока нет.", reviewsCount: "{n} {w}", child: "ребёнок {age}",
      book: "Записаться через Telegram", demo: "Демо: профиль и отзывы вымышлены.", online: "работает онлайн",
      years: function (n) { return n + " " + (n % 10 === 1 && n % 100 !== 11 ? "год" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "года" : "лет"); },
      revWord: function (n) { return n % 10 === 1 && n % 100 !== 11 ? "отзыв" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "отзыва" : "отзывов"; },
      langBadge: "на казахском"
    },
    kk: {
      kicker: "Маман карточкасы", loading: "Жүктелуде…", notFound: "Маман табылмады. Карточка жариялаудан алынған болуы мүмкін.",
      noConfig: "Сайт базаға қосылмаған: Supabase мекенжайы мен кілті берілмеген (config.js).", error: "Карточканы жүктеу мүмкін болмады. Бетті жаңартып көріңіз.",
      city: "Қала", format: "Формат", langs: "Сабақ тілдері", ages: "Балалардың жасы", price: "Құны", exp: "Жұмыс тәжірибесі",
      priceUnknown: "көрсетілмеген", free: "тегін", perMin: "{min} мин — {price}",
      av_available: "Жаңа өтініштер қабылдайды", av_waitlist: "Күту тізімі", av_unknown: "Жазылу туралы дерек жоқ",
      about: "Маман туралы", quals: "Біліктілігі", qualsNote: "маманның өз сөзі бойынша, құжаттар тексерілмеген",
      reviews: "Ата-аналардың пікірлері", noReviews: "Әзірге пікір жоқ.", reviewsCount: "{n} {w}", child: "бала {age}",
      book: "Telegram арқылы жазылу", demo: "Демо: профиль мен пікірлер ойдан шығарылған.", online: "онлайн жұмыс істейді",
      years: function (n) { return n + " жыл"; },
      revWord: function () { return "пікір"; },
      langBadge: "орыс тілінде"
    }
  };

  function lang() { return window.I18N && window.I18N.lang() === "kk" ? "kk" : "ru"; }
  function L(pair) { return pair ? pair[lang() === "kk" ? 1 : 0] : ""; }
  function t(key, vars) {
    var s = T[lang()][key];
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? vars[k] : m; });
    return s;
  }
  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₸"; }
  function dateText(iso) {
    var p = String(iso).split("-");
    return p.length === 3 ? Number(p[2]) + " " + MONTHS[lang()][Number(p[1]) - 1] + " " + p[0] : "";
  }
  function stars(r) { return "★★★★★".slice(0, r) + "☆☆☆☆☆".slice(0, 5 - r); }

  function render() {
    if (!data) { root.innerHTML = '<p class="panel__note">' + esc(t("loading")) + "</p>"; return; }
    if (data.error) { root.innerHTML = '<div class="panel"><p>' + esc(t(data.error)) + '</p><p style="margin-top:16px"><a class="btn btn--ghost btn--small" href="index.html#specialists">I-Help</a></p></div>'; return; }
    var s = data.spec, reviews = data.reviews;
    var dir = L(DIRS[s.specialty_code]) || s.specialty_code;
    var about = s.about && (s.about[lang()] || s.about.ru);
    var price = s.price_kzt == null ? t("priceUnknown") : (s.price_kzt === 0 ? t("free") : money(s.price_kzt));
    if (s.price_kzt != null && s.duration_min) price = t("perMin", { price: price, min: s.duration_min });
    var rows = [
      [t("city"), s.city ? L(CITIES[s.city]) || s.city : t("online")],
      [t("format"), (s.formats || []).map(function (f) { return L(FORMATS[f]); }).join(", ")],
      [t("langs"), (s.languages || []).map(function (l) { return L(LANGS[l]); }).join(", ")],
      [t("ages"), (s.age_bands || []).map(function (a) { return L(AGES[a]); }).join(", ")],
      [t("price"), price]
    ];
    if (s.experience_years) rows.push([t("exp"), T[lang()].years(s.experience_years)]);
    var avg = reviews.length ? reviews.reduce(function (a, r) { return a + r.rating; }, 0) / reviews.length : 0;
    var quals = (s.qualifications || []).map(function (q) { return "<li>" + esc(q.title ? (q.title[lang()] || q.title.ru) : "") + "</li>"; }).join("");
    var initials = String(s.display_name).split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase();
    document.title = s.display_name + " — " + dir + " · I-Help";

    root.innerHTML =
      '<p class="quiz__kicker">' + esc(t("kicker")) + "</p>" +
      '<div class="spec-page__grid">' +
      '<section class="panel spec-card">' +
        '<div class="spec-card__avatar" aria-hidden="true">' + esc(initials) + "</div>" +
        '<h1 class="spec-card__name">' + esc(s.display_name) + "</h1>" +
        '<p class="spec-card__dir">' + esc(dir) + "</p>" +
        '<p class="spec-card__badges"><span class="spec-badge spec-badge--' + esc(s.availability) + '">' + esc(t("av_" + s.availability)) + "</span>" +
        (reviews.length ? '<span class="spec-rating" aria-label="' + esc(avg.toFixed(1)) + ' / 5">★ ' + esc(avg.toFixed(1).replace(".", lang() === "kk" ? "," : ",")) + " · " +
          esc(t("reviewsCount", { n: reviews.length, w: T[lang()].revWord(reviews.length) })) + "</span>" : "") + "</p>" +
        '<dl class="spec-facts">' + rows.map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("") + "</dl>" +
        (cfg.TELEGRAM_URL ? '<a class="btn btn--block" href="' + esc(cfg.TELEGRAM_URL) + '" target="_blank" rel="noopener">' + esc(t("book")) + "</a>" : "") +
      "</section>" +
      '<div class="spec-page__main">' +
        (about ? '<section class="panel"><h2 class="panel__title">' + esc(t("about")) + "</h2><p>" + esc(about) + "</p>" +
          (quals ? '<h3 class="spec-sub">' + esc(t("quals")) + '</h3><p class="panel__note">' + esc(t("qualsNote")) + '</p><ul class="spec-quals">' + quals + "</ul>" : "") +
          "</section>" : "") +
        '<section class="panel"><h2 class="panel__title">' + esc(t("reviews")) + "</h2>" +
          (reviews.length ? '<ul class="reviews">' + reviews.map(function (r) {
            return '<li class="review"><div class="review__head"><span class="review__stars" aria-label="' + r.rating + ' / 5">' + stars(r.rating) + "</span>" +
              '<span class="review__date">' + esc(dateText(r.created_on)) + "</span></div>" +
              '<p class="review__body"' + (r.lang === "kk" ? ' lang="kk"' : ' lang="ru"') + ">" + esc(r.body) + "</p>" +
              '<p class="review__who">' + esc(r.author) + (r.city && CITIES[r.city] ? ", " + esc(L(CITIES[r.city])) : "") +
              (r.child_age && AGES[r.child_age] ? " · " + esc(t("child", { age: L(AGES[r.child_age]) })) : "") + "</p></li>";
          }).join("") + "</ul>" : '<p class="panel__note">' + esc(t("noReviews")) + "</p>") +
        "</section>" +
        '<p class="panel__note spec-demo">' + esc(t("demo")) + "</p>" +
      "</div></div>";
  }

  function rest(path) {
    return fetch(cfg.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/" + path, {
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY }
    }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  if (params.get("lang") === "kk" || params.get("lang") === "ru") {
    if (window.I18N && window.I18N.lang() !== params.get("lang")) window.I18N.set(params.get("lang"));
  }
  document.addEventListener("langchange", render);
  render();

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.indexOf("YOUR-") === 0) {
    data = { error: "noConfig" }; render(); return;
  }
  if (!/^[\w-]+$/.test(id)) { data = { error: "notFound" }; render(); return; }
  Promise.all([
    rest("specialists?id=eq." + encodeURIComponent(id) + "&status=eq.published&select=*"),
    rest("specialist_reviews?specialist_id=eq." + encodeURIComponent(id) + "&select=author,city,child_age,rating,lang,body,created_on&order=created_on.desc&limit=50")
  ]).then(function (res) {
    data = res[0] && res[0][0] ? { spec: res[0][0], reviews: res[1] || [] } : { error: "notFound" };
    render();
  }).catch(function (e) {
    console.error(e);
    data = { error: "error" };
    render();
  });
})();
