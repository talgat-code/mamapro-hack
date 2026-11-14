(function () {
  var cfg = window.APP_CONFIG || {};
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

  /* ---------- Кнопки мессенджеров: ссылки из APP_CONFIG ---------- */
  each(document.querySelectorAll("a[data-config-url]"), function (a) {
    var url = cfg[a.getAttribute("data-config-url")];
    if (url) {
      a.href = url;
      a.hidden = false;
    }
  });
  each(document.querySelectorAll(".messengers"), function (box) {
    box.hidden = !box.querySelector("a[data-config-url]:not([hidden])");
  });

  /* ---------- Форма заявки ---------- */
  var form = document.getElementById("lead-form");
  var status = document.getElementById("lead-status");
  var btn = document.getElementById("lead-submit");
  var prefillNote = document.getElementById("prefill-note");
  var prefilled = ""; // последний текст, подставленный из опроса
  var client = null;

  if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf("YOUR-") !== 0) {
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  function show(text, ok) {
    status.textContent = text;
    status.className = "form__status " + (ok ? "form__status--ok" : "form__status--err");
  }

  form.addEventListener("reset", function () {
    prefilled = "";
    prefillNote.hidden = true;
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!form.elements.consent.checked) return show("Отметьте согласие на обработку персональных данных.", false);
    if (!client) return show("Ошибка, попробуйте позже.", false);

    var data = new FormData(form);
    var row = {
      name: data.get("name").trim(),
      contact: data.get("contact").trim(),
      message: data.get("message").trim() || null
    };

    btn.disabled = true;
    btn.textContent = "Отправляем…";
    var res = await client.from("leads").insert(row);
    btn.disabled = false;
    btn.textContent = "Отправить заявку";

    if (res.error) return show("Ошибка, попробуйте позже.", false);
    form.reset();
    show("Спасибо, мы свяжемся!", true);
  });

  /* ---------- Мини-опрос «Подберём специалиста» ---------- */
  var quiz = document.getElementById("quiz-form");
  if (!quiz) return;

  // Правила подбора: ответ «С чем нужна помощь» -> типы специалистов (по убыванию приоритета).
  // Ключи специалистов совпадают с id карточек на странице (spec-<ключ>).
  var DONT_KNOW = "не знаю";
  var RULES = {
    max: 2,
    topics: {
      "речь": ["logoped"],
      "обучение и внимание": ["neuro", "defect"],
      "поведение и эмоции": ["psych", "aba"],
      "моторика и движение": ["lfk"],
      "не знаю": ["defect"]
    },
    names: {
      logoped: "логопед",
      defect: "дефектолог",
      neuro: "нейропсихолог",
      psych: "психолог",
      lfk: "ЛФК-инструктор",
      aba: "АВА-терапевт"
    }
  };

  function recommend(topics) {
    var score = {};
    var order = [];
    topics.forEach(function (topic) {
      var list = RULES.topics[topic] || [];
      list.forEach(function (key, i) {
        if (!(key in score)) { score[key] = 0; order.push(key); }
        score[key] += list.length - i;
      });
    });
    order.sort(function (a, b) { return score[b] - score[a]; });
    return { keys: order.slice(0, RULES.max), cut: order.length > RULES.max };
  }

  var steps = Array.prototype.slice.call(quiz.querySelectorAll(".quiz__step"));
  var progress = document.getElementById("quiz-progress");
  var bar = document.getElementById("quiz-bar");
  var error = document.getElementById("quiz-error");
  var back = document.getElementById("quiz-back");
  var next = document.getElementById("quiz-next");
  var result = document.getElementById("quiz-result");
  var current = 0;
  var last = null; // ответы и рекомендация последнего прохождения

  function checkedValues(name) {
    return Array.prototype.map.call(quiz.querySelectorAll('input[name="' + name + '"]:checked'), function (i) { return i.value; });
  }

  function isFilled(step) {
    return step.getAttribute("data-step") === "city" || !!step.querySelector("input:checked");
  }

  function render(moveFocus) {
    steps.forEach(function (s, i) { s.hidden = i !== current; });
    progress.textContent = "Шаг " + (current + 1) + " из " + steps.length;
    bar.style.width = ((current + 1) / steps.length * 100) + "%";
    back.hidden = current === 0;
    next.textContent = current === steps.length - 1 ? "Подобрать специалиста" : "Далее";
    error.textContent = "";
    if (moveFocus) steps[current].focus({ preventScroll: true });
  }

  quiz.addEventListener("change", function (e) {
    var t = e.target;
    error.textContent = "";
    // «Не знаю» исключает остальные варианты, и наоборот
    if (t.name === "topic" && t.checked) {
      each(quiz.querySelectorAll('input[name="topic"]'), function (o) {
        if (o !== t && ((t.value === DONT_KNOW) !== (o.value === DONT_KNOW))) o.checked = false;
      });
    }
  });

  back.addEventListener("click", function () {
    if (current > 0) { current--; render(true); }
  });

  quiz.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!isFilled(steps[current])) {
      error.textContent = steps[current].getAttribute("data-step") === "topic" ? "Выберите хотя бы один вариант." : "Выберите один вариант.";
      return;
    }
    if (current < steps.length - 1) { current++; render(true); } else { showResult(); }
  });

  function showResult() {
    var topics = checkedValues("topic");
    var rec = recommend(topics);
    var names = rec.keys.map(function (k) { return RULES.names[k]; });
    last = {
      age: checkedValues("age")[0],
      topics: topics,
      format: checkedValues("format")[0],
      city: quiz.elements.city.value.trim(),
      names: names
    };

    document.getElementById("quiz-result-title").textContent = "Вам может подойти: " + names.join(" или ");

    var list = document.getElementById("quiz-recs");
    list.textContent = "";
    rec.keys.forEach(function (key) {
      var card = document.getElementById("spec-" + key);
      var desc = card && card.querySelector("p");
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#spec-" + key;
      a.textContent = RULES.names[key].charAt(0).toUpperCase() + RULES.names[key].slice(1);
      li.appendChild(a);
      if (desc) li.appendChild(document.createTextNode(" — " + desc.textContent));
      list.appendChild(li);
    });

    var why = topics.indexOf(DONT_KNOW) !== -1
      ? "Вы не знаете, с чего начать, — предлагаем начать с дефектолога как с общего ориентира."
      : "Подобрано по вашему запросу: " + topics.join("; ") + ".";
    if (rec.cut) why += " Запросов несколько, поэтому показаны два самых близких типа специалистов — остальное можно обсудить при подборе.";
    why += " Возраст, формат и город попадут в текст заявки — вы сможете их поправить.";
    document.getElementById("quiz-why").textContent = why;

    quiz.hidden = true;
    result.hidden = false;
    result.focus({ preventScroll: true });
  }

  document.getElementById("quiz-apply").addEventListener("click", function () {
    if (!last) return;
    var line = "Опрос: возраст " + last.age +
      ", запрос: " + last.topics.join("; ") +
      ", формат: " + last.format +
      ", город: " + (last.city || "не указан") +
      ", рекомендовано: " + last.names.join(" или ");

    // Подставляем в message; текст, который родитель уже написал сам, сохраняем
    var msg = form.elements.message;
    var rest = msg.value.trim();
    if (prefilled && rest.indexOf(prefilled) === 0) rest = rest.slice(prefilled.length).trim();
    msg.value = rest ? line + "\n" + rest : line;
    prefilled = line;
    prefillNote.hidden = false;

    var target = document.getElementById("lead");
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    document.getElementById("lead-title").focus({ preventScroll: true });
  });

  document.getElementById("quiz-restart").addEventListener("click", function () {
    quiz.reset();
    current = 0;
    last = null;
    result.hidden = true;
    quiz.hidden = false;
    render(true);
    document.getElementById("quiz").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });

  render(false);
})();
