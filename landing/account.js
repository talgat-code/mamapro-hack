(function () {
  var cfg = window.APP_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("acc-status");
  var t = function (s, vars) { return window.I18N ? window.I18N.t(s, vars) : s; };
  var hello = function (name) { return name ? t("Здравствуйте, {name}!", { name: name }) : t("Здравствуйте!"); };
  var ROLE_NAMES = { parent: "Кабинет родителя", specialist: "Кабинет специалиста", admin: "Кабинет организатора" };
  var STATUS_NAMES = { draft: "черновик", published: "опубликована", hidden: "скрыта", pending: "на проверке", approved: "одобрено", rejected: "отклонено" };
  var CARD_FIELDS = ["display_name", "specialty_code", "city", "formats", "about"];
  var FIELD_LABELS = { display_name: "Имя", specialty_code: "Специальность", city: "Город", formats: "Формат", about: "О себе" };
  // Коды — как в каталоге бота (supabase/functions/_shared/catalog.mjs)
  var SPECIALTIES = {
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
  var CITIES = { almaty: ["Алматы", "Алматы"], astana: ["Астана", "Астана"], oskemen: ["Усть-Каменогорск", "Өскемен"], shymkent: ["Шымкент", "Шымкент"], kostanay: ["Костанай", "Қостанай"] };
  var FORMATS = { on: "Онлайн", off: "Очно" };
  function label(dict, code) {
    var v = dict[code];
    if (!v) return code || "—";
    return v[window.I18N && window.I18N.lang() === "kk" ? 1 : 0];
  }
  function fillCodeSelects() {
    Array.prototype.forEach.call(document.querySelectorAll("select[data-codes]"), function (sel) {
      var city = sel.getAttribute("data-codes") === "city";
      var dict = city ? CITIES : SPECIALTIES;
      var keep = sel.value;
      sel.textContent = "";
      if (city) sel.appendChild(new Option("—", ""));
      Object.keys(dict).forEach(function (code) { sel.appendChild(new Option(label(dict, code), code)); });
      if (keep) sel.value = keep;
    });
  }
  function cardFromForm(form) {
    return {
      display_name: form.elements.display_name.value.trim(),
      specialty_code: form.elements.specialty_code.value,
      city: form.elements.city.value || null,
      formats: Array.prototype.map.call(form.querySelectorAll("input[name=formats]:checked"), function (i) { return i.value; }),
      about: form.elements.about.value.trim()
    };
  }
  function cardToForm(form, row) {
    form.elements.display_name.value = row.display_name || "";
    form.elements.specialty_code.value = row.specialty_code || "logoped";
    form.elements.city.value = row.city || "";
    Array.prototype.forEach.call(form.querySelectorAll("input[name=formats]"), function (i) { i.checked = (row.formats || []).indexOf(i.value) !== -1; });
    form.elements.about.value = (row.about && row.about.ru) || "";
  }
  function payloadText(k, v) {
    if (k === "specialty_code") return label(SPECIALTIES, v);
    if (k === "city") return v ? label(CITIES, v) : "—";
    if (k === "formats") return (v || []).map(function (f) { return t(FORMATS[f] || f); }).join(", ");
    return v ? String(v) : "—";
  }

  function say(text, ok) {
    statusEl.textContent = text || "";
    statusEl.className = "acc-status" + (text ? (ok ? " acc-status--ok" : " acc-status--err") : "");
  }
  function fail(err) {
    console.error(err);
    say(t("Что-то пошло не так, попробуйте позже."), false);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, cls, onClick) {
    var b = el("button", "btn btn--small " + (cls || ""), text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  function date(iso) {
    try { return new Date(iso).toLocaleDateString(window.I18N ? window.I18N.locale() : "ru-RU"); } catch (e) { return ""; }
  }
  function formValues(form, fields) {
    var out = {};
    fields.forEach(function (f) { out[f] = (form.elements[f].value || "").trim(); });
    return out;
  }
  function fillForm(form, row, fields) {
    fields.forEach(function (f) { if (form.elements[f]) form.elements[f].value = row && row[f] != null ? row[f] : ""; });
  }
  function emptyNote(list, text) {
    if (!list.children.length) list.appendChild(el("li", "items__empty", text));
  }

  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.indexOf("YOUR-") === 0) {
    say(t("Кабинет временно недоступен: не настроено подключение к базе."), false);
    $("view-guest").hidden = false;
    return;
  }
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var me = null; // { user, profile }

  /* ---------- Гость: вкладки, вход, регистрация ---------- */
  function setTab(login) {
    $("tab-login").setAttribute("aria-selected", String(login));
    $("tab-signup").setAttribute("aria-selected", String(!login));
    $("login-form").hidden = !login;
    $("signup-form").hidden = login;
    say("");
  }
  $("tab-login").addEventListener("click", function () { setTab(true); });
  $("tab-signup").addEventListener("click", function () { setTab(false); });

  $("login-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = e.target;
    var res = await sb.auth.signInWithPassword({ email: f.elements.email.value.trim(), password: f.elements.password.value });
    if (res.error) return say(t("Не получилось войти: проверьте email и пароль."), false);
    f.reset();
    load();
  });

  $("signup-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = e.target;
    if (!f.elements.consent.checked) return say(t("Отметьте согласие на обработку персональных данных."), false);
    var role = f.querySelector('input[name="role"]:checked').value;
    var res = await sb.auth.signUp({
      email: f.elements.email.value.trim(),
      password: f.elements.password.value,
      options: {
        data: { role: role, full_name: f.elements.full_name.value.trim() },
        emailRedirectTo: location.href.split("#")[0]
      }
    });
    if (res.error) return say(t("Не получилось зарегистрироваться: {error}.", { error: res.error.message || t("попробуйте позже") }), false);
    f.reset();
    if (res.data.session) return load();
    setTab(true);
    say(t("Почти готово! Мы отправили письмо — подтвердите email и войдите."), true);
  });

  $("logout").addEventListener("click", async function () {
    await sb.auth.signOut();
    me = null;
    say(t("Вы вышли из кабинета."), true);
    load();
  });

  /* ---------- Профиль ---------- */
  $("profile-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var v = formValues(e.target, ["full_name", "phone", "city"]);
    var res = await sb.from("profiles").update({ full_name: v.full_name, phone: v.phone || null, city: v.city || null }).eq("id", me.user.id);
    if (res.error) return fail(res.error);
    $("acc-hello").textContent = hello(v.full_name);
    say(t("Данные сохранены."), true);
  });

  /* ---------- Родитель ---------- */
  async function loadChildren() {
    var res = await sb.from("children").select("id, nickname, age_group, topics, city").order("created_at");
    if (res.error) return fail(res.error);
    var list = $("children-list");
    list.textContent = "";
    res.data.forEach(function (c) {
      var li = el("li", "items__row");
      var info = el("div");
      info.appendChild(el("strong", null, c.nickname));
      info.appendChild(el("p", "items__meta", t("{age} лет", { age: c.age_group }) + (c.topics.length ? " · " + c.topics.map(function (x) { return t(x); }).join(", ") : "") + (c.city ? " · " + c.city : "")));
      li.appendChild(info);
      li.appendChild(button(t("Удалить"), "btn--ghost", async function () {
        if (!confirm(t("Удалить данные ребёнка «{name}»?", { name: c.nickname }))) return;
        var r = await sb.from("children").delete().eq("id", c.id);
        if (r.error) return fail(r.error);
        loadChildren();
      }));
      list.appendChild(li);
    });
    emptyNote(list, t("Пока никого не добавили."));
  }

  $("child-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = e.target;
    if (!f.elements.guardian.checked) return say(t("Подтвердите, что вы законный представитель ребёнка."), false);
    var topics = Array.prototype.map.call(f.querySelectorAll('input[name="topics"]:checked'), function (i) { return i.value; });
    var res = await sb.from("children").insert({
      nickname: f.elements.nickname.value.trim(),
      age_group: f.elements.age_group.value,
      topics: topics,
      city: f.elements.city.value.trim() || null
    });
    if (res.error) return fail(res.error);
    f.reset();
    say(t("Ребёнок добавлен."), true);
    loadChildren();
  });

  async function loadLeads() {
    var res = await sb.from("leads").select("created_at, message").eq("user_id", me.user.id).order("created_at", { ascending: false });
    if (res.error) return fail(res.error);
    var list = $("leads-list");
    list.textContent = "";
    res.data.forEach(function (l) {
      var li = el("li", "items__row items__row--col");
      li.appendChild(el("strong", null, t("Заявка от {date}", { date: date(l.created_at) })));
      if (l.message) li.appendChild(el("p", "items__meta", l.message));
      list.appendChild(li);
    });
    emptyNote(list, t("Заявок пока нет."));
  }

  /* ---------- Специалист ---------- */
  var myCard = null;

  async function loadCard() {
    var res = await sb.from("specialists").select("*").eq("user_id", me.user.id).maybeSingle();
    if (res.error) return fail(res.error);
    myCard = res.data;
    var form = $("card-form");
    if (!myCard) {
      $("card-state").textContent = t("Карточка ещё не создана. Напишите организаторам.");
      form.hidden = true;
      return;
    }
    form.hidden = false;
    cardToForm(form, myCard);
    $("card-state").textContent = t("Статус карточки: {status}.", { status: t(STATUS_NAMES[myCard.status] || myCard.status) }) +
      (myCard.status === "published" ? "" : " " + t("Её видят только вы и организаторы."));

    var ch = await sb.from("specialist_changes").select("created_at, status, review_note").eq("author_id", me.user.id).order("created_at", { ascending: false });
    if (ch.error) return fail(ch.error);
    var list = $("my-changes");
    list.textContent = "";
    ch.data.forEach(function (c) {
      var li = el("li", "items__row items__row--col");
      li.appendChild(el("strong", null, date(c.created_at) + " — " + t(STATUS_NAMES[c.status] || c.status)));
      if (c.review_note) li.appendChild(el("p", "items__meta", t("Комментарий: {note}", { note: c.review_note })));
      list.appendChild(li);
    });
    emptyNote(list, t("Правок пока не было."));
  }

  $("card-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!myCard) return;
    var card = cardFromForm(e.target);
    if (!card.formats.length) return say(t("Выберите хотя бы один формат."), false);
    var res = await sb.from("specialist_changes").insert({ specialist_id: myCard.id, payload: card });
    if (res.error) return fail(res.error);
    say(t("Правка отправлена на проверку организаторам."), true);
    loadCard();
  });

  /* ---------- Организатор ---------- */
  async function loadReview() {
    var res = await sb.from("specialist_changes").select("id, created_at, payload, specialists(display_name)").eq("status", "pending").order("created_at");
    if (res.error) return fail(res.error);
    var list = $("review-list");
    list.textContent = "";
    res.data.forEach(function (c) {
      var li = el("li", "items__row items__row--col");
      li.appendChild(el("strong", null, (c.specialists ? c.specialists.display_name : t("Специалист")) + " · " + date(c.created_at)));
      var dl = el("dl", "diff");
      CARD_FIELDS.forEach(function (k) {
        if (c.payload[k] == null) return;
        dl.appendChild(el("dt", null, t(FIELD_LABELS[k])));
        dl.appendChild(el("dd", null, payloadText(k, c.payload[k])));
      });
      li.appendChild(dl);
      var actions = el("div", "items__actions");
      actions.appendChild(button(t("Одобрить"), "", function () { review(c.id, true); }));
      actions.appendChild(button(t("Отклонить"), "btn--ghost", function () {
        var note = prompt(t("Причина (увидит специалист):"), "");
        if (note === null) return;
        review(c.id, false, note);
      }));
      li.appendChild(actions);
      list.appendChild(li);
    });
    emptyNote(list, t("Новых правок нет."));
  }

  async function review(id, approve, note) {
    var res = await sb.rpc("review_specialist_change", { change_id: id, approve: approve, note: note || null });
    if (res.error) return fail(res.error);
    say(approve ? t("Правка одобрена.") : t("Правка отклонена."), true);
    loadReview();
    loadSpecs();
  }

  async function loadSpecs() {
    // Демо-профили (их 500+) ведёт генератор supabase/demo — здесь только реальные карточки
    var res = await sb.from("specialists").select("id, display_name, specialty_code, city, status").eq("is_demo", false).order("updated_at");
    if (res.error) return fail(res.error);
    var list = $("spec-list");
    list.textContent = "";
    res.data.forEach(function (s) {
      var li = el("li", "items__row");
      var info = el("div");
      info.appendChild(el("strong", null, s.display_name));
      info.appendChild(el("p", "items__meta", label(SPECIALTIES, s.specialty_code) + (s.city ? " · " + label(CITIES, s.city) : "") + " · " + t(STATUS_NAMES[s.status] || s.status)));
      li.appendChild(info);
      var actions = el("div", "items__actions");
      var publish = s.status !== "published";
      actions.appendChild(button(publish ? t("Опубликовать") : t("Скрыть"), publish ? "" : "btn--ghost", async function () {
        var r = await sb.from("specialists").update({ status: publish ? "published" : "hidden", updated_at: new Date().toISOString() }).eq("id", s.id);
        if (r.error) return fail(r.error);
        loadSpecs();
      }));
      actions.appendChild(button(t("Удалить"), "btn--ghost", async function () {
        if (!confirm(t("Удалить карточку «{name}»? Это нельзя отменить.", { name: s.display_name }))) return;
        var r = await sb.from("specialists").delete().eq("id", s.id);
        if (r.error) return fail(r.error);
        loadSpecs();
      }));
      li.appendChild(actions);
      list.appendChild(li);
    });
    emptyNote(list, t("Специалистов пока нет."));
  }

  $("spec-add-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var c = cardFromForm(e.target);
    if (!c.formats.length) return say(t("Выберите хотя бы один формат."), false);
    var res = await sb.from("specialists").insert({
      is_demo: false, status: "draft", display_name: c.display_name, specialty_code: c.specialty_code,
      city: c.city, formats: c.formats, about: c.about ? { ru: c.about } : {}
    });
    if (res.error) return fail(res.error);
    e.target.reset();
    say(t("Черновик добавлен. Опубликуйте его, когда будет готов."), true);
    loadSpecs();
  });

  /* ---------- Загрузка кабинета ---------- */
  async function load() {
    var s = await sb.auth.getSession();
    var user = s.data.session && s.data.session.user;
    $("view-guest").hidden = !!user;
    $("view-user").hidden = !user;
    if (!user) return;

    var p = await sb.from("profiles").select("*").eq("id", user.id).single();
    if (p.error) return fail(p.error);
    me = { user: user, profile: p.data };
    var role = p.data.role;
    fillCodeSelects();

    $("acc-role").textContent = t(ROLE_NAMES[role] || "");
    $("acc-hello").textContent = hello(p.data.full_name);
    fillForm($("profile-form"), p.data, ["full_name", "phone", "city"]);
    Array.prototype.forEach.call(document.querySelectorAll("[data-role]"), function (sec) {
      sec.hidden = sec.getAttribute("data-role") !== role;
    });

    try {
      if (role === "parent") await Promise.all([loadChildren(), loadLeads()]);
      if (role === "specialist") await loadCard();
      if (role === "admin") await Promise.all([loadReview(), loadSpecs()]);
    } catch (err) { fail(err); }
  }

  document.addEventListener("langchange", function () { say(""); load().catch(fail); });

  if (location.hash === "#signup") setTab(false);
  load().catch(fail);
})();
