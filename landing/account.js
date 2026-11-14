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

  /* ---------- Родитель: карточка ребёнка ---------- */
  var kids = []; // карточки детей текущего родителя (с полем specialists)
  var editId = null;

  // «Айгуль — логопед», «Айгуль - логопед», «Айгуль: логопед», «Айгуль, логопед».
  function parseSpecialist(line) {
    var v = line.replace(/\s+/g, " ").trim();
    var seps = [/\s*[—–]\s*/, /\s+-\s+/, /\s*[:,]\s*/];
    for (var i = 0; i < seps.length; i++) {
      var m = seps[i].exec(v);
      if (!m) continue;
      var name = v.slice(0, m.index).trim(), spec = v.slice(m.index + m[0].length).trim();
      return name && spec && name.length <= 60 && spec.length <= 60 ? { name: name, specialty: spec } : null;
    }
    return null;
  }

  function fillChildSelects() {
    Array.prototype.forEach.call(document.querySelectorAll("select[data-child-select]"), function (sel) {
      var keep = sel.value;
      sel.textContent = "";
      kids.forEach(function (c) { sel.appendChild(new Option(c.nickname, c.id)); });
      if (keep) sel.value = keep;
      sel.closest("form").querySelector("button[type=submit]").disabled = !kids.length;
    });
  }

  function childMeta(c) {
    var lines = [t("{age} лет", { age: c.age_group }) + (c.topics.length ? " · " + c.topics.map(function (x) { return t(x); }).join(", ") : "") + (c.city ? " · " + c.city : "")];
    var none = t("нет");
    lines.push("📌 " + t("Диагнозы") + ": " + (c.diagnoses && c.diagnoses.length ? c.diagnoses.join(", ") : none));
    lines.push("👨‍⚕️ " + t("Специалисты") + ": " + (c.specialists.length ? c.specialists.map(function (s) { return s.name + " — " + s.specialty; }).join("; ") : none));
    lines.push("💊 " + t("Лекарства") + ": " + (c.medications || none));
    lines.push("⚠️ " + t("Аллергии") + ": " + (c.allergies || none));
    return lines.join("\n");
  }

  function resetChildForm() {
    var f = $("child-form");
    f.reset();
    editId = null;
    $("child-form-title").textContent = t("Новая карточка");
    $("child-submit").textContent = t("Добавить");
    $("child-cancel").hidden = true;
  }

  function editChild(c) {
    var f = $("child-form");
    editId = c.id;
    f.elements.nickname.value = c.nickname;
    f.elements.age_group.value = c.age_group;
    Array.prototype.forEach.call(f.querySelectorAll('input[name="topics"]'), function (i) { i.checked = c.topics.indexOf(i.value) !== -1; });
    f.elements.city.value = c.city || "";
    f.elements.diagnoses.value = (c.diagnoses || []).join(", ");
    f.elements.specialists.value = c.specialists.map(function (s) { return s.name + " — " + s.specialty; }).join("\n");
    f.elements.medications.value = c.medications || "";
    f.elements.allergies.value = c.allergies || "";
    $("child-form-title").textContent = t("Редактирование: {name}", { name: c.nickname });
    $("child-submit").textContent = t("Сохранить");
    $("child-cancel").hidden = false;
    f.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadChildren() {
    var res = await sb.from("children").select("id, nickname, age_group, topics, city, diagnoses, allergies, medications, child_specialists(name, specialty, created_at)").order("created_at");
    if (res.error) return fail(res.error);
    kids = res.data.map(function (c) {
      c.specialists = (c.child_specialists || []).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
      return c;
    });
    var list = $("children-list");
    list.textContent = "";
    kids.forEach(function (c) {
      var li = el("li", "items__row");
      var info = el("div");
      info.appendChild(el("strong", null, "👦 " + c.nickname));
      info.appendChild(el("p", "items__meta", childMeta(c)));
      li.appendChild(info);
      var actions = el("div", "items__actions");
      actions.appendChild(button(t("Изменить"), "", function () { editChild(c); }));
      actions.appendChild(button(t("Удалить"), "btn--ghost", async function () {
        if (!confirm(t("Удалить карточку «{name}» вместе с дневником? Это нельзя отменить.", { name: c.nickname }))) return;
        var r = await sb.from("children").delete().eq("id", c.id);
        if (r.error) return fail(r.error);
        if (editId === c.id) resetChildForm();
        loadChildren();
      }));
      li.appendChild(actions);
      list.appendChild(li);
    });
    emptyNote(list, t("Пока никого не добавили."));
    fillChildSelects();
    loadDiaryMonth().catch(fail);
  }

  $("child-cancel").addEventListener("click", resetChildForm);

  $("child-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = e.target;
    if (!f.elements.guardian.checked) return say(t("Подтвердите, что вы законный представитель ребёнка."), false);
    var topics = Array.prototype.map.call(f.querySelectorAll('input[name="topics"]:checked'), function (i) { return i.value; });
    var diagnoses = f.elements.diagnoses.value.split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (diagnoses.length > 10 || diagnoses.some(function (x) { return x.length > 60; })) return say(t("До 10 диагнозов, каждый до 60 символов."), false);
    var specLines = f.elements.specialists.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
    var specs = specLines.map(parseSpecialist);
    if (specs.indexOf(null) !== -1) return say(t("Специалистов пишите по одному в строке: Имя — специальность."), false);
    if (specs.length > 10) return say(t("В карточке может быть до 10 специалистов."), false);
    var row = {
      nickname: f.elements.nickname.value.trim(),
      age_group: f.elements.age_group.value,
      topics: topics,
      city: f.elements.city.value.trim() || null,
      diagnoses: diagnoses,
      medications: f.elements.medications.value.trim() || null,
      allergies: f.elements.allergies.value.trim() || null
    };
    var res = editId
      ? await sb.from("children").update(row).eq("id", editId).select("id").single()
      : await sb.from("children").insert(row).select("id").single();
    if (res.error) return fail(res.error);
    var id = res.data.id;
    // Список специалистов заменяется целиком.
    var del = await sb.from("child_specialists").delete().eq("child_id", id);
    if (del.error) return fail(del.error);
    if (specs.length) {
      var ins = await sb.from("child_specialists").insert(specs.map(function (s) { return { child_id: id, name: s.name, specialty: s.specialty }; }));
      if (ins.error) return fail(ins.error);
    }
    say(editId ? t("Карточка сохранена.") : t("Ребёнок добавлен."), true);
    resetChildForm();
    loadChildren();
  });

  /* ---------- Родитель: дневник ---------- */
  var MOOD_ICON = { good: "😊", normal: "😐", bad: "😢" };
  // Дата по местному времени браузера в формате YYYY-MM-DD.
  function isoLocal(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function moodCounts(list) {
    var c = { good: 0, normal: 0, bad: 0 };
    list.forEach(function (e) { if (e.mood in c) c[e.mood] += 1; });
    return c;
  }

  async function loadDiaryMonth() {
    var out = $("diary-month");
    var childId = document.querySelector("#diary-form select[name=child]").value;
    var child = kids.filter(function (c) { return c.id === childId; })[0];
    if (!child) { out.textContent = t("Сначала добавьте карточку ребёнка — дневник привязан к ней."); return; }
    var now = new Date();
    var res = await sb.from("diary_entries").select("mood").eq("child_id", child.id).gte("date", isoLocal(new Date(now.getFullYear(), now.getMonth(), 1)));
    if (res.error) return fail(res.error);
    var m = moodCounts(res.data);
    var month = now.toLocaleDateString(window.I18N ? window.I18N.locale() : "ru-RU", { month: "long" });
    out.textContent = t("За {month} у {name}: {good} 😊, {normal} 😐, {bad} 😢", { month: month, name: child.nickname, good: m.good, normal: m.normal, bad: m.bad });
  }

  document.querySelector("#diary-form select[name=child]").addEventListener("change", function () { loadDiaryMonth().catch(fail); });

  $("diary-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = e.target;
    var mood = f.querySelector('input[name="mood"]:checked');
    if (!f.elements.child.value || !mood) return say(t("Выберите ребёнка и как прошёл день."), false);
    if (f.elements.date.value > isoLocal(new Date())) return say(t("Дата не может быть в будущем."), false);
    var res = await sb.from("diary_entries").insert({
      child_id: f.elements.child.value,
      date: f.elements.date.value,
      mood: mood.value,
      tags: Array.prototype.map.call(f.querySelectorAll('input[name="tags"]:checked'), function (i) { return i.value; }),
      note: f.elements.note.value.trim() || null
    });
    if (res.error) return fail(res.error);
    var keep = f.elements.child.value;
    f.reset();
    f.elements.child.value = keep;
    f.elements.date.value = isoLocal(new Date());
    say(t("Записано! ✅"), true);
    loadDiaryMonth().catch(fail);
  });

  /* ---------- Родитель: отчёт для специалиста ---------- */
  var AGE_LABEL = { "до 3": "до 3 лет", "3–6": "3–6 лет", "7–12": "7–12 лет", "13+": "13+ лет" };
  function dmy(iso) { var p = String(iso).split("-"); return p[2] + "." + p[1] + "." + p[0]; }

  $("report-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var f = e.target;
    var child = kids.filter(function (c) { return c.id === f.elements.child.value; })[0];
    if (!child) return say(t("Сначала добавьте карточку ребёнка."), false);
    var days = Number(f.elements.days.value);
    var to = new Date();
    var from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (days - 1));
    var res = await sb.from("diary_entries").select("date, mood, tags, note, created_at").eq("child_id", child.id)
      .gte("date", isoLocal(from)).lte("date", isoLocal(to)).order("date").order("created_at");
    if (res.error) return fail(res.error);
    var list = res.data;
    if (!list.length) { $("report-box").hidden = true; return say(t("За этот период записей нет. Начните вести дневник!"), false); }
    var has = function (e, code) { return (e.tags || []).indexOf(code) !== -1; };
    var count = function (code) { return list.filter(function (e) { return has(e, code); }).length; };
    var uniq = function (arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }).length; };
    var m = moodCounts(list);
    var SEP = "══════════════════════";
    var lines = [SEP, t("📊 ОТЧЁТ О РАЗВИТИИ"), child.nickname + ", " + t(AGE_LABEL[child.age_group] || child.age_group),
      t("Период: {from} – {to}", { from: dmy(isoLocal(from)), to: dmy(isoLocal(to)) }), SEP,
      t("📈 Настроение: {good} 😊, {normal} 😐, {bad} 😢", m),
      t("📌 Отметки: новые слова — {words}, истерики — {tantrums}, плохой сон — {sleep}, плохой аппетит — {eat}, лекарство — {meds}, д/з — {hw} из {days}", {
        words: count("new_word"), tantrums: count("tantrum"), sleep: count("bad_sleep"), eat: count("bad_eat"), meds: count("medicine"),
        hw: uniq(list.filter(function (e) { return has(e, "homework"); }).map(function (e) { return e.date; })),
        days: uniq(list.map(function (e) { return e.date; }))
      })];
    var notes = list.filter(function (e) { return e.note; }).slice(-5);
    if (notes.length) {
      lines.push(t("💬 Заметки:"));
      notes.forEach(function (e) { lines.push("• " + dmy(e.date) + " " + MOOD_ICON[e.mood] + ": " + e.note); });
    } else lines.push(t("💬 Заметок нет."));
    lines.push(SEP, t("Составлено по записям родителя в дневнике I-Help. Это наблюдения, а не медицинское заключение."));
    $("report-out").textContent = lines.join("\n");
    $("report-box").hidden = false;
    say("");
  });

  $("report-copy").addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText($("report-out").textContent);
      say(t("Отчёт скопирован — вставьте его в сообщение специалисту."), true);
    } catch (err) { say(t("Не получилось скопировать — выделите текст вручную."), false); }
  });
  // Печатается только отчёт (см. @media print в style.css).
  $("report-print").addEventListener("click", function () {
    document.body.classList.add("printing-report");
    window.print();
    document.body.classList.remove("printing-report");
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

  document.addEventListener("langchange", function () {
    say("");
    if (editId) resetChildForm();
    $("report-box").hidden = true;
    load().catch(fail);
  });

  $("diary-form").elements.date.value = isoLocal(new Date());
  $("diary-form").elements.date.max = isoLocal(new Date());
  if (location.hash === "#signup") setTab(false);
  load().catch(fail);
})();
