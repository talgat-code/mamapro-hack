(function () {
  var form = document.getElementById("lead-form");
  var status = document.getElementById("lead-status");
  var btn = document.getElementById("lead-submit");
  var cfg = window.APP_CONFIG || {};
  var client = null;

  if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.indexOf("YOUR-") !== 0) {
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  function show(text, ok) {
    status.textContent = text;
    status.className = "form__status " + (ok ? "form__status--ok" : "form__status--err");
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
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
})();
