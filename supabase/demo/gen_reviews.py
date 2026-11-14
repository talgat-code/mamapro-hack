"""Генератор вымышленных демо-отзывов родителей для public.specialist_reviews.

ВСЕ ОТЗЫВЫ ВЫМЫШЛЕНЫ (is_demo = true) и относятся к вымышленным демо-профилям; на сайте они помечены как демо.
Профили берутся из миграции демо-специалистов (supabase/migrations/*_expand_demo_specialists.sql).

  python supabase/demo/gen_reviews.py > supabase/migrations/<дата>_<имя>.sql
Детерминированно: одинаковый вывод при каждом запуске.
"""
import datetime as dt
import glob
import random
import re
import sys

rnd = random.Random(20261116)

src = sorted(glob.glob("supabase/migrations/*_expand_demo_specialists.sql"))[-1]
ROW = re.compile(r"^  \('(p\d+)', '[^']*', '(\w+)', (null|'\w+'), array\[[^\]]*\]::text\[\], array\[[^\]]*\]::text\[\], array\[([^\]]*)\]::text\[\]")
specs = []
for line in open(src, encoding="utf-8"):
    m = ROW.match(line)
    if m:
        ages = [a.strip().strip("'") for a in m.group(4).split(",") if a.strip()]
        specs.append((m.group(1), m.group(2), None if m.group(3) == "null" else m.group(3).strip("'"), ages))
if not specs:
    sys.exit("не нашёл профили в " + src)

GROUP = {
    "logoped": "speech", "surdopedagog": "speech", "audiologist": "speech",
    "spec_pedagog": "learn", "tiflopedagog": "learn", "neuropsychologist": "learn",
    "child_psychologist": "psych", "child_psychiatrist": "psych",
    "rehabilitologist": "move", "lfk_instructor": "move", "ergotherapist": "move", "orthopedist": "move",
}  # остальные — врачи ("med")

# (ru, kk)
OPEN = [("Ходим уже {n} месяца.", "{n} ай болды қатынап жүрміз."),
        ("Нашли по рекомендации в чате мам.", "Аналар чатындағы ұсыныс бойынша таптық."),
        ("Были на первой консультации.", "Алғашқы кеңесте болдық."),
        ("Занимаемся с весны.", "Көктемнен бері айналысып жүрміз."),
        ("Долго искали своего специалиста.", "Өз маманымызды ұзақ іздедік.")]
DETAIL = {
    "speech": [("Сын начал говорить первые слова.", "Ұлым алғашқы сөздерін айта бастады."),
               ("Дочка стала чётче выговаривать звуки.", "Қызым дыбыстарды анығырақ айтатын болды."),
               ("Дала понятные упражнения на дом.", "Үйге түсінікті жаттығулар берді."),
               ("Ребёнок с удовольствием идёт на занятия.", "Бала сабаққа қуана барады.")],
    "learn": [("Ребёнку стало легче сосредоточиться на уроках.", "Балаға сабақта зейін қою жеңілдеді."),
              ("Объясняет спокойно, без давления.", "Қысымсыз, сабырмен түсіндіреді."),
              ("Подобрала упражнения на внимание и память.", "Зейін мен есте сақтауға жаттығулар таңдады."),
              ("Домашние задания теперь без слёз.", "Үй тапсырмасы енді көз жассыз орындалады.")],
    "psych": [("Истерик стало заметно меньше.", "Ашу-ыза айтарлықтай азайды."),
              ("Помогла пережить адаптацию к садику.", "Балабақшаға бейімделуге көмектесті."),
              ("Дала советы и нам, родителям.", "Бізге, ата-аналарға да кеңес берді."),
              ("Ребёнок ждёт встреч с радостью.", "Бала кездесуді қуанып күтеді.")],
    "move": [("Сын стал увереннее ходить.", "Ұлым сенімдірек жүре бастады."),
             ("Упражнения легко повторять дома.", "Жаттығуларды үйде қайталау оңай."),
             ("Дочь научилась сама держать ложку.", "Қызым қасықты өзі ұстауды үйренді."),
             ("Занятия проходят в игре, ребёнку нравится.", "Сабақ ойын түрінде өтеді, балаға ұнайды.")],
    "med": [("Внимательно выслушала и всё объяснила.", "Мұқият тыңдап, бәрін түсіндірді."),
            ("Назначения понятные, без лишних анализов.", "Тағайындаулар түсінікті, артық талдаусыз."),
            ("Ответила на все вопросы, не торопила.", "Барлық сұраққа жауап берді, асықтырмады."),
            ("Нашла подход к ребёнку, он не боялся.", "Балаға жол тапты, ол қорықпады.")],
}
GOOD_END = [("Рекомендую!", "Ұсынамын!"), ("Спасибо за терпение.", "Шыдамдылығыңызға рақмет."),
            ("Будем продолжать.", "Жалғастырамыз."), ("Очень довольны.", "Өте ризамыз.")]
MID_END = [("Хотелось бы больше обратной связи после занятий.", "Сабақтан кейін көбірек кері байланыс болса екен."),
           ("Было сложно записаться, но специалист хороший.", "Жазылу қиын болды, бірақ маман жақсы."),
           ("Пока результат небольшой, посмотрим дальше.", "Әзірге нәтиже аз, әрі қарай көреміз.")]
MOMS = ["Айгуль", "Динара", "Асель", "Мадина", "Ольга", "Жанна", "Салтанат", "Елена", "Гульнара", "Айжан", "Наталья",
        "Камила", "Лаура", "Аружан", "Татьяна", "Индира", "Мария", "Зарина", "Ирина", "Шолпан", "Сабина", "Алия", "Юлия",
        "Карина", "Гаухар", "Анель", "Светлана", "Томирис", "Дарина", "Меруерт", "Виктория", "Әсел", "Анна", "Жибек"]
CITY_ALL = ["almaty", "almaty", "astana", "astana", "shymkent", "oskemen", "kostanay"]
TODAY = dt.date(2026, 11, 15)


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


rows = []
for sid, code, city, ages in specs:
    group = GROUP.get(code, "med")
    n = rnd.choices([0, 1, 2, 3, 4, 5, 6, 7], weights=[4, 8, 16, 20, 18, 14, 12, 8])[0]
    used = set()
    for _ in range(n):
        rating = rnd.choices([5, 4, 3], weights=[62, 29, 9])[0]
        lang = "kk" if rnd.random() < 0.3 else "ru"
        li = 1 if lang == "kk" else 0
        parts = [rnd.choice(OPEN)[li].format(n=rnd.randint(2, 4))]
        child_age = rnd.choice(ages) if ages else None
        # «первые слова», «ложку держать», «садик» — только про малышей
        early = ("первые слова", "держать ложку", "к садику")
        pool = [x for x in DETAIL[group] if child_age in ("0-2", "3-5") or not any(w in x[0] for w in early)]
        d = rnd.sample(pool, 2 if rnd.random() < 0.45 and len(pool) > 1 else 1)
        parts += [x[li] for x in d]
        parts.append(rnd.choice(MID_END if rating == 3 else GOOD_END)[li])
        body = " ".join(parts)
        if body in used:
            continue
        used.add(body)
        rows.append("  (%s, %s, %s, %s, %d, %s, %s, %s)" % (
            q(sid), q(rnd.choice(MOMS)), q(city or rnd.choice(CITY_ALL)), q(child_age),
            rating, q(lang), q(body), q((TODAY - dt.timedelta(days=rnd.randint(3, 330))).isoformat())))

print("""-- Вымышленные демо-отзывы родителей о демо-специалистах. ВСЕ ОТЗЫВЫ ВЫМЫШЛЕНЫ.
-- Сгенерировано supabase/demo/gen_reviews.py — правьте генератор, а не этот файл.
delete from public.specialist_reviews where is_demo;

insert into public.specialist_reviews (specialist_id, author, city, child_age, rating, lang, body, created_on)
values""")
print(",\n".join(rows) + ";")
print("-- профилей: %d, отзывов: %d" % (len(specs), len(rows)), file=sys.stderr)
