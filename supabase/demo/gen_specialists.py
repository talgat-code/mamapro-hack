"""Генератор вымышленных демо-профилей специалистов -> SQL-миграция с таблицей public.specialists.

Все люди, цены и квалификации выдуманы (is_demo = true). Реальные имена, телефоны, фото не используются.
Запуск: python supabase/demo/gen_specialists.py > supabase/migrations/20261115120000_create_specialists.sql
Детерминированно: одинаковый вывод при каждом запуске.
"""
import json
import random

rnd = random.Random(20261115)

# Коды направлений совпадают с catalog.mjs (SECTIONS[].dirs[].code).
DIRS = {
    "logoped": ("Логопедия", "Логопедия"),
    "spec_pedagog": ("Специальная педагогика", "Арнайы педагогика"),
    "surdopedagog": ("Сурдопедагогика", "Сурдопедагогика"),
    "tiflopedagog": ("Тифлопедагогика", "Тифлопедагогика"),
    "child_psychologist": ("Психология", "Психология"),
    "neuropsychologist": ("Клиническая психология", "Клиникалық психология"),
    "child_psychiatrist": ("Психиатрия", "Психиатрия"),
    "pediatrician": ("Педиатрия", "Педиатрия"),
    "child_neurologist": ("Неврология", "Неврология"),
    "geneticist": ("Медицинская генетика", "Медициналық генетика"),
    "orthopedist": ("Травматология и ортопедия", "Травматология және ортопедия"),
    "rehabilitologist": ("Медицинская реабилитация", "Медициналық оңалту"),
    "lfk_instructor": ("Адаптивная физкультура", "Бейімделген дене шынықтыру"),
    "ergotherapist": ("Эрготерапия", "Эрготерапия"),
    "ophthalmologist": ("Офтальмология", "Офтальмология"),
    "ent": ("Оториноларингология", "Оториноларингология"),
    "audiologist": ("Сурдология", "Сурдология"),
    "gastroenterologist": ("Гастроэнтерология", "Гастроэнтерология"),
    "endocrinologist": ("Эндокринология", "Эндокринология"),
    "dietitian": ("Диетология", "Диетология"),
}

# Короткие описания по направлению (RU, KZ).
ABOUT = {
    "logoped": [("Запуск речи, звукопроизношение, подготовка к школе.", "Сөйлеуді бастау, дыбыстау, мектепке дайындық."),
                ("Развитие связной речи и словаря, занятия в игре.", "Байланыстырып сөйлеу мен сөздік қорды дамыту, ойын арқылы сабақ."),
                ("Ранняя помощь, занятия вместе с родителем.", "Ерте көмек, атамен-анамен бірге сабақ.")],
    "spec_pedagog": [("Учебные навыки, внимание, адаптация в школе.", "Оқу дағдылары, зейін, мектепке бейімделу."),
                     ("Развитие мышления и самостоятельности в игре.", "Ойында ойлау мен дербестікті дамыту."),
                     ("Ранний возраст, сенсорное развитие.", "Ерте жас, сенсорлық даму.")],
    "surdopedagog": [("Развитие слухового восприятия и речи у детей с нарушением слуха.", "Есту қабілеті бұзылған балаларда есту қабылдауы мен сөйлеуді дамыту.")],
    "tiflopedagog": [("Занятия для детей с нарушением зрения: ориентировка, осязание.", "Көру қабілеті бұзылған балаларға сабақ: бағдарлау, сипап сезу.")],
    "child_psychologist": [("Эмоции и поведение, адаптация к саду и школе.", "Эмоциялар мен мінез-құлық, балабақша мен мектепке бейімделу."),
                           ("Игровая терапия, работа с тревогой и страхами.", "Ойын терапиясы, мазасыздық пен қорқынышпен жұмыс."),
                           ("Консультации для семьи и подростков.", "Отбасы мен жасөспірімдерге кеңес.")],
    "neuropsychologist": [("Диагностика и развитие внимания, памяти, саморегуляции.", "Зейінді, есте сақтауды, өзін-өзі реттеуді диагностикалау және дамыту."),
                          ("Нейропсихологическая коррекция для дошкольников и школьников.", "Мектеп жасына дейінгі және мектеп оқушыларына нейропсихологиялық түзету.")],
    "child_psychiatrist": [("Консультации по развитию и поведению ребёнка.", "Баланың дамуы мен мінез-құлқы бойынша кеңес.")],
    "pediatrician": [("Наблюдение за развитием, консультации для родителей.", "Дамуды бақылау, ата-аналарға кеңес."),
                     ("Детский врач, приём детей с особенностями развития.", "Балалар дәрігері, даму ерекшеліктері бар балаларды қабылдау.")],
    "child_neurologist": [("Консультации по развитию нервной системы, задержкам развития.", "Жүйке жүйесінің дамуы, дамудың кешігуі бойынша кеңес."),
                          ("Приём детей с судорожными состояниями и нарушениями сна.", "Құрысу және ұйқы бұзылыстары бар балаларды қабылдау.")],
    "orthopedist": [("Осанка, стопы, контроль развития опорно-двигательной системы.", "Мүсін, табан, тірек-қимыл жүйесінің дамуын бақылау.")],
    "rehabilitologist": [("Программы восстановления движения, подбор средств реабилитации.", "Қозғалысты қалпына келтіру бағдарламалары, оңалту құралдарын таңдау.")],
    "lfk_instructor": [("Лечебная физкультура, моторика и координация.", "Емдік дене шынықтыру, моторика және үйлесімділік."),
                       ("Занятия в воде и в зале, укрепление мышц.", "Суда және залда сабақ, бұлшықеттерді нығайту.")],
    "ergotherapist": [("Бытовые навыки: еда, одевание, мелкая моторика.", "Тұрмыстық дағдылар: тамақтану, киіну, ұсақ моторика.")],
    "ophthalmologist": [("Проверка зрения, подбор очков, наблюдение.", "Көруді тексеру, көзілдірік таңдау, бақылау.")],
    "ent": [("Приём по вопросам слуха, носа и горла.", "Есту, мұрын және тамақ бойынша қабылдау.")],
    "gastroenterologist": [("Пищеварение, избирательность в еде.", "Ас қорыту, тағамды талғап жеу.")],
    "endocrinologist": [("Рост, вес, обмен веществ.", "Бой, салмақ, зат алмасу.")],
    "dietitian": [("Рацион для детей с особенностями питания.", "Тамақтану ерекшеліктері бар балаларға рацион.")],
}

# Не заполняем: врач-генетик и сурдолог — чтобы в демо оставалось предусмотренное пустое состояние.
COUNTS = {
    "logoped": 6, "spec_pedagog": 5, "surdopedagog": 2, "tiflopedagog": 1,
    "child_psychologist": 5, "neuropsychologist": 3, "child_psychiatrist": 1,
    "pediatrician": 3, "child_neurologist": 2, "orthopedist": 1, "rehabilitologist": 2,
    "lfk_instructor": 3, "ergotherapist": 2, "ophthalmologist": 1, "ent": 1,
    "gastroenterologist": 1, "endocrinologist": 1, "dietitian": 2,
}
MEDICAL = {"child_psychiatrist", "pediatrician", "child_neurologist", "orthopedist", "rehabilitologist",
           "ophthalmologist", "ent", "gastroenterologist", "endocrinologist"}

CITIES = ["almaty", "almaty", "almaty", "astana", "astana", "shymkent", "oskemen", "kostanay"]
AGES = ["0-2", "3-5", "6-9", "10-13", "14-17", "18+"]

FIRST = ["Айгерим", "Марина", "Дана", "Ольга", "Ерлан", "Сауле", "Асель", "Жанар", "Ирина", "Гульнара", "Алия", "Татьяна",
         "Нурлан", "Динара", "Елена", "Мадина", "Арман", "Камила", "Светлана", "Бахыт", "Айжан", "Наталья", "Тимур", "Жибек",
         "Анна", "Ляззат", "Руслан", "Альмира", "Виктория", "Санжар", "Карлыгаш", "Юлия", "Айдана", "Галия", "Максат",
         "Екатерина", "Шолпан", "Аружан", "Дарья", "Ерболат", "Гаухар", "Людмила", "Акмарал", "Мария", "Данияр"]
INITIALS = "АБВГДЕЖЗИКЛМНОПРСТУХШ"

# Первые шесть — прежние встроенные профили (id p1–p6 сохраняются: на них могут ссылаться избранное и обращения).
FIXED = [
    dict(id="p1", name="Айгерим С.", dir="logoped", city="almaty", formats=["off", "on"], langs=["kk", "ru"], ages=["3-5", "6-9", "10-13"], price=8000, minutes=45, availability="available", about=ABOUT["logoped"][0], exp=9),
    dict(id="p2", name="Марина К.", dir="logoped", city="astana", formats=["on"], langs=["ru"], ages=["0-2", "3-5", "6-9"], price=5000, minutes=40, availability="available", about=ABOUT["logoped"][2], exp=6),
    dict(id="p3", name="Дана Е.", dir="logoped", city="almaty", formats=["off"], langs=["kk"], ages=["3-5", "6-9"], price=0, minutes=30, availability="available",
         about=("Бесплатные занятия по программе фонда.", "Қор бағдарламасы бойынша тегін сабақтар."), exp=4),
    dict(id="p4", name="Ольга В.", dir="spec_pedagog", city="shymkent", formats=["off", "on"], langs=["ru"], ages=["6-9", "10-13", "14-17"], price=10000, minutes=60, availability="waitlist", about=ABOUT["spec_pedagog"][0], exp=15),
    dict(id="p5", name="Ерлан Т.", dir="spec_pedagog", city="almaty", formats=["on"], langs=["kk", "ru"], ages=["3-5", "6-9", "10-13"], price=6000, minutes=45, availability="available", about=ABOUT["spec_pedagog"][1], exp=7),
    dict(id="p6", name="Сауле М.", dir="spec_pedagog", city="kostanay", formats=["off"], langs=["kk", "ru"], ages=["0-2", "3-5"], price=4000, minutes=45, availability="available", about=ABOUT["spec_pedagog"][2], exp=11),
]


def make():
    rows = list(FIXED)
    used = {r["name"].split()[0] for r in rows}
    names = [n for n in FIRST if n not in used]
    rnd.shuffle(names)
    n = 7
    for code, cnt in COUNTS.items():
        have = sum(1 for r in rows if r["dir"] == code)
        for _ in range(cnt - have):
            first = names.pop()
            medical = code in MEDICAL
            fmt = rnd.choice([["off"], ["off", "on"], ["on"], ["off", "on"]] if not medical else [["off"], ["off"], ["off", "on"]])
            lo = rnd.randint(0, 3)
            hi = rnd.randint(lo + 1, 5 if code in ("child_psychologist", "dietitian", "endocrinologist") else 4)
            if medical:
                price = rnd.choice([9000, 10000, 12000, 15000, 18000, None])
                minutes = rnd.choice([20, 30, 30, 40])
            else:
                price = rnd.choice([0, 4000, 5000, 6000, 7000, 8000, 9000, 12000, None])
                minutes = rnd.choice([30, 40, 45, 45, 60])
            rows.append(dict(
                id="p%d" % n, name="%s %s." % (first, rnd.choice(INITIALS)), dir=code,
                city=rnd.choice(CITIES) if fmt != ["on"] or rnd.random() < 0.7 else None,
                formats=fmt, langs=rnd.choice([["ru"], ["kk"], ["kk", "ru"], ["kk", "ru"], ["ru"]]),
                ages=AGES[lo:hi + 1], price=price, minutes=minutes,
                availability=rnd.choice(["available", "available", "available", "waitlist", "unknown"]),
                about=rnd.choice(ABOUT[code]), exp=rnd.randint(2, 20)))
            if rows[-1]["about"][0].startswith("Ранн"):  # «ранняя помощь / ранний возраст» — только малыши
                rows[-1]["ages"] = ["0-2", "3-5"]
            n += 1
    return rows


def sql_str(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def sql_arr(a):
    return "array[" + ", ".join(sql_str(x) for x in a) + "]::text[]"


def main():
    rows = make()
    out = []
    out.append("""-- Демо-профили специалистов (контракт SpecialistProfile из docs/TRD.md). ВСЕ ДАННЫЕ ВЫМЫШЛЕНЫ.
-- Сгенерировано supabase/demo/gen_specialists.py — правьте генератор, а не этот файл.
-- price_kzt / duration_min: null — «не указано» (не ноль и не бесплатно); 0 — бесплатно.
-- qualifications: [{title:{ru,kk}, check_status}] — в демо только selfReported (документы никто не проверял).
-- availability: available — принимает новые обращения, waitlist — лист ожидания, unknown — нет данных.
create table public.specialists (
  id               text primary key,
  is_demo          boolean not null default true,
  display_name     text not null,
  specialty_code   text not null,
  city             text,
  formats          text[] not null check (formats <@ array['off', 'on']::text[] and cardinality(formats) > 0),
  languages        text[] not null check (languages <@ array['kk', 'ru']::text[] and cardinality(languages) > 0),
  age_bands        text[] not null check (age_bands <@ array['0-2', '3-5', '6-9', '10-13', '14-17', '18+']::text[]),
  price_kzt        integer check (price_kzt is null or price_kzt >= 0),
  duration_min     integer check (duration_min is null or duration_min > 0),
  availability     text not null default 'unknown' check (availability in ('available', 'waitlist', 'unknown')),
  experience_years integer,
  about            jsonb not null default '{}'::jsonb,
  qualifications   jsonb not null default '[]'::jsonb,
  updated_at       timestamptz not null default now()
);

create index specialists_specialty on public.specialists (specialty_code);

-- Вымышленные профили читать может кто угодно (бот, лендинг); менять — только service_role.
alter table public.specialists enable row level security;
create policy "specialists_read_public" on public.specialists for select to anon, authenticated using (true);
revoke all on public.specialists from anon, authenticated;
grant select on public.specialists to anon, authenticated;
grant select, insert, update, delete on public.specialists to service_role;

insert into public.specialists
  (id, display_name, specialty_code, city, formats, languages, age_bands, price_kzt, duration_min, availability,
   experience_years, about, qualifications)
values""")
    vals = []
    for r in rows:
        ru, kk = DIRS[r["dir"]]
        quals = [{"title": {"ru": "Высшее образование: " + ru, "kk": "Жоғары білім: " + kk}, "check_status": "selfReported"}]
        about = {"ru": r["about"][0], "kk": r["about"][1]}
        vals.append("  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %d, %s::jsonb, %s::jsonb)" % (
            sql_str(r["id"]), sql_str(r["name"]), sql_str(r["dir"]), sql_str(r["city"]), sql_arr(r["formats"]),
            sql_arr(r["langs"]), sql_arr(r["ages"]), "null" if r["price"] is None else r["price"],
            "null" if r["minutes"] is None else r["minutes"], sql_str(r["availability"]), r["exp"],
            sql_str(json.dumps(about, ensure_ascii=False)), sql_str(json.dumps(quals, ensure_ascii=False))))
    out.append(",\n".join(vals) + ";\n")
    print("\n".join(out), end="")


if __name__ == "__main__":
    main()
