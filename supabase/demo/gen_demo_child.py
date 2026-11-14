"""Демо-карточка ребёнка и дневник за 12 недель для одного чата Telegram-бота (показать «Прогресс» на демо).

ДАННЫЕ ВЫМЫШЛЕНЫ. Скрипт печатает SQL; применять к своей базе вручную (psql), это не миграция:
id чата — личные данные, в репозиторий его не кладём.

  python supabase/demo/gen_demo_child.py <chat_id> [YYYY-MM-DD — последний день, по умолчанию сегодня] > demo.sql

Если у чата уже есть карточка с тем же именем, она пересоздаётся (вместе с дневником — on delete cascade).
"""
import datetime as dt
import json
import random
import sys

if len(sys.argv) < 2 or not sys.argv[1].lstrip("-").isdigit():
    sys.exit("usage: gen_demo_child.py <chat_id> [YYYY-MM-DD]")
CHAT = int(sys.argv[1])
END = dt.date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else dt.date.today()
DAYS = 84
NAME = "Алия"
rnd = random.Random(CHAT % 100000 + 7)

NOTES = {
    3: "Первое занятие с логопедом, весь вечер была уставшей.",
    9: "Плакала, когда выключили мультфильм.",
    16: "Логопед дала карточки для занятий дома.",
    22: "Сама сказала «пить»!",
    30: "Хорошо спала после прогулки.",
    37: "Показала пальцем и сказала «кот».",
    44: "Спокойно ждала в очереди в поликлинике.",
    51: "Повторяет слова из песенки.",
    58: "Назвала бабушку «аже».",
    65: "Первая фраза: «мама, дай».",
    72: "Играла с детьми на площадке, не убегала.",
    79: "Попросила почитать книжку и показывала картинки.",
}


def lerp(a, b, x):
    return a + (b - a) * x


rows = []
start = END - dt.timedelta(days=DAYS - 1)
for i in range(DAYS):
    day = start + dt.timedelta(days=i)
    if rnd.random() < 0.12 and i not in NOTES:  # пропуски — как в жизни
        continue
    x = (i / (DAYS - 1)) ** 0.85
    p_good = lerp(0.28, 0.72, x)
    p_bad = lerp(0.3, 0.08, x)
    r = rnd.random()
    mood = "good" if r < p_good else ("bad" if r < p_good + p_bad else "normal")
    tags = []
    if rnd.random() < lerp(0.05, 0.55, x):
        tags.append("new_word")
    if rnd.random() < lerp(0.6, 0.12, x) * (1.3 if mood == "bad" else 0.7):
        tags.append("tantrum")
    if rnd.random() < lerp(0.3, 0.1, x):
        tags.append("bad_sleep")
    if rnd.random() < 0.12:
        tags.append("bad_eat")
    if day.weekday() in (0, 2, 4) and rnd.random() < lerp(0.4, 0.85, x):
        tags.append("homework")
    note = NOTES.get(i)
    if note and "new_word" not in tags and any(w in note for w in ("сказала", "Назвала", "фраза", "Повторяет", "кот")):
        tags.insert(0, "new_word")
    rows.append((day.isoformat(), mood, tags, note))


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


print("-- Демо-дневник (вымышленный) для чата бота. Сгенерировано supabase/demo/gen_demo_child.py.")
print("begin;")
print("delete from public.bot_children where chat_id = %d and name = %s;" % (CHAT, q(NAME)))
print("with c as (insert into public.bot_children (chat_id, name, age_group, diagnoses, created_at, updated_at)")
print("  values (%d, %s, '3-5', '{}', %s, now()) returning id)," % (CHAT, q(NAME), q(start.isoformat() + "T09:00:00+05")))
print("s as (insert into public.bot_child_specialists (child_id, name, specialty)")
print("  select id, v.name, v.spec from c, (values ('Айгерим С.', 'логопед'), ('Ерлан Т.', 'специальный педагог')) v(name, spec))")
print("insert into public.bot_diary_entries (child_id, date, mood, tags, note, created_at)")
print("select c.id, v.d::date, v.m, v.t::text[], v.n, (v.d || 'T20:30:00+05')::timestamptz from c, (values")
print(",\n".join("  (%s, %s, %s, %s)" % (q(d), q(m), q("{" + ",".join(t) + "}"), q(n)) for d, m, t, n in rows))
print(") v(d, m, t, n);")
print("commit;")
print("-- записей: %d, период %s — %s" % (len(rows), start.isoformat(), END.isoformat()), file=sys.stderr)
