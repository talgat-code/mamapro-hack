"""Генератор вымышленных демо-профилей специалистов для таблицы public.specialists.

Все люди, цены и квалификации выдуманы (is_demo = true). Реальные имена, телефоны, фото не используются.
Схема таблицы — миграция 20261115120000_create_specialists.sql. Этот скрипт выдаёт миграцию данных:
удаляет демо-строки и вставляет набор заново.

  python supabase/demo/gen_specialists.py > supabase/migrations/<дата>_<имя>.sql

Набор строится в два прохода:
  1. реалистичная основа — по нескольку профилей на каждое направление в каждом городе и онлайн;
  2. покрытие — для КАЖДОЙ комбинации «направление × город × возраст × язык × формат × бюджет»
     должен найтись профиль, который принимает новые обращения; если нет, добавляется подходящий.
Правила подбора повторяют matchesProfile из supabase/functions/_shared/bot.mjs.
Единственная непокрываемая комбинация — «Другой город» + «Очно»: город введён текстом, очных профилей там нет.
Детерминированно: одинаковый вывод при каждом запуске.
"""
import json
import random
import sys

rnd = random.Random(20261115)

# Коды направлений — как в catalog.mjs (SECTIONS[].dirs[].code): (название специальности RU, KZ).
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
MEDICAL = {"child_psychiatrist", "pediatrician", "child_neurologist", "geneticist", "orthopedist", "rehabilitologist",
           "ophthalmologist", "ent", "audiologist", "gastroenterologist", "endocrinologist"}

# Описания по направлению (RU, KZ); "early" — про ранний возраст (только 0–5 лет).
ABOUT = {
    "logoped": [("Запуск речи, звукопроизношение, подготовка к школе.", "Сөйлеуді бастау, дыбыстау, мектепке дайындық."),
                ("Развитие связной речи и словаря, занятия в игре.", "Байланыстырып сөйлеу мен сөздік қорды дамыту, ойын арқылы сабақ."),
                ("Коррекция письма и чтения у школьников.", "Мектеп оқушыларында жазу мен оқуды түзету."),
                ("Альтернативная коммуникация: карточки, жесты, планшет.", "Балама коммуникация: карточкалар, ымдар, планшет.")],
    "spec_pedagog": [("Учебные навыки, внимание, адаптация в школе.", "Оқу дағдылары, зейін, мектепке бейімделу."),
                     ("Развитие мышления и самостоятельности в игре.", "Ойында ойлау мен дербестікті дамыту."),
                     ("Индивидуальная программа обучения, подготовка к ПМПК.", "Жеке оқу бағдарламасы, ПМПК-ға дайындық.")],
    "surdopedagog": [("Развитие слухового восприятия и речи у детей с нарушением слуха.", "Есту қабілеті бұзылған балаларда есту қабылдауы мен сөйлеуді дамыту."),
                     ("Занятия после кохлеарной имплантации.", "Кохлеарлық имплантациядан кейінгі сабақтар.")],
    "tiflopedagog": [("Занятия для детей с нарушением зрения: ориентировка, осязание.", "Көру қабілеті бұзылған балаларға сабақ: бағдарлау, сипап сезу."),
                     ("Обучение Брайлю и навыкам самостоятельности.", "Брайль әліпбиіне және дербестік дағдыларына үйрету.")],
    "child_psychologist": [("Эмоции и поведение, адаптация к саду и школе.", "Эмоциялар мен мінез-құлық, балабақша мен мектепке бейімделу."),
                           ("Игровая терапия, работа с тревогой и страхами.", "Ойын терапиясы, мазасыздық пен қорқынышпен жұмыс."),
                           ("Консультации для семьи и подростков.", "Отбасы мен жасөспірімдерге кеңес.")],
    "neuropsychologist": [("Диагностика и развитие внимания, памяти, саморегуляции.", "Зейінді, есте сақтауды, өзін-өзі реттеуді диагностикалау және дамыту."),
                          ("Нейропсихологическая коррекция для дошкольников и школьников.", "Мектеп жасына дейінгі және мектеп оқушыларына нейропсихологиялық түзету.")],
    "child_psychiatrist": [("Консультации по развитию и поведению ребёнка.", "Баланың дамуы мен мінез-құлқы бойынша кеңес."),
                           ("Наблюдение и сопровождение семьи, разбор назначений.", "Отбасын бақылау және сүйемелдеу, тағайындауларды түсіндіру.")],
    "pediatrician": [("Наблюдение за развитием, консультации для родителей.", "Дамуды бақылау, ата-аналарға кеңес."),
                     ("Детский врач, приём детей с особенностями развития.", "Балалар дәрігері, даму ерекшеліктері бар балаларды қабылдау.")],
    "child_neurologist": [("Консультации по развитию нервной системы, задержкам развития.", "Жүйке жүйесінің дамуы, дамудың кешігуі бойынша кеңес."),
                          ("Приём детей с судорожными состояниями и нарушениями сна.", "Құрысу және ұйқы бұзылыстары бар балаларды қабылдау.")],
    "geneticist": [("Консультация семьи, разбор результатов генетических анализов.", "Отбасына кеңес, генетикалық талдау нәтижелерін түсіндіру."),
                   ("Подбор обследований и планирование наблюдения.", "Тексерулерді таңдау және бақылауды жоспарлау.")],
    "orthopedist": [("Осанка, стопы, контроль развития опорно-двигательной системы.", "Мүсін, табан, тірек-қимыл жүйесінің дамуын бақылау."),
                    ("Подбор ортезов и обуви, наблюдение после операций.", "Ортездер мен аяқ киім таңдау, операциядан кейінгі бақылау.")],
    "rehabilitologist": [("Программы восстановления движения, подбор средств реабилитации.", "Қозғалысты қалпына келтіру бағдарламалары, оңалту құралдарын таңдау.")],
    "lfk_instructor": [("Лечебная физкультура, моторика и координация.", "Емдік дене шынықтыру, моторика және үйлесімділік."),
                       ("Занятия в воде и в зале, укрепление мышц.", "Суда және залда сабақ, бұлшықеттерді нығайту.")],
    "ergotherapist": [("Бытовые навыки: еда, одевание, мелкая моторика.", "Тұрмыстық дағдылар: тамақтану, киіну, ұсақ моторика."),
                      ("Адаптация дома и рабочего места, вспомогательные средства.", "Үйді және жұмыс орнын бейімдеу, қосалқы құралдар.")],
    "ophthalmologist": [("Проверка зрения, подбор очков, наблюдение.", "Көруді тексеру, көзілдірік таңдау, бақылау.")],
    "ent": [("Приём по вопросам слуха, носа и горла.", "Есту, мұрын және тамақ бойынша қабылдау.")],
    "audiologist": [("Проверка слуха, подбор и настройка слуховых аппаратов.", "Есту қабілетін тексеру, есту аппараттарын таңдау және баптау.")],
    "gastroenterologist": [("Пищеварение, избирательность в еде.", "Ас қорыту, тағамды талғап жеу.")],
    "endocrinologist": [("Рост, вес, обмен веществ.", "Бой, салмақ, зат алмасу.")],
    "dietitian": [("Рацион для детей с особенностями питания.", "Тамақтану ерекшеліктері бар балаларға рацион."),
                  ("Расширение рациона при пищевой избирательности.", "Тағамды талғап жеу кезінде рационды кеңейту.")],
}
EARLY = ("Ранняя помощь, занятия вместе с родителем.", "Ерте көмек, атамен-анамен бірге сабақ.")
FREE_PED = ("Бесплатные занятия по программе фонда.", "Қор бағдарламасы бойынша тегін сабақтар.")
FREE_MED = ("Приём бесплатно по ОСМС (направление от участкового врача).", "МӘМС бойынша тегін қабылдау (учаскелік дәрігердің жолдамасы бойынша).")

CITIES = ["almaty", "astana", "oskemen", "shymkent", "kostanay"]
CITY_WEIGHT = {"almaty": 3, "astana": 3, "shymkent": 2, "oskemen": 1, "kostanay": 1}  # базовых профилей на направление
AGES = ["0-2", "3-5", "6-9", "10-13", "14-17", "18+"]
LANGS = ["kk", "ru"]
BUDGETS = [10000, 5000, 0]  # порядок добора: сначала платные; «без ограничения» покрывается любым из них

FIRST = ["Айгерим", "Марина", "Дана", "Ольга", "Ерлан", "Сауле", "Асель", "Жанар", "Ирина", "Гульнара", "Алия", "Татьяна",
         "Нурлан", "Динара", "Елена", "Мадина", "Арман", "Камила", "Светлана", "Бахыт", "Айжан", "Наталья", "Тимур", "Жибек",
         "Анна", "Ляззат", "Руслан", "Альмира", "Виктория", "Санжар", "Карлыгаш", "Юлия", "Айдана", "Галия", "Максат",
         "Екатерина", "Шолпан", "Аружан", "Дарья", "Ерболат", "Гаухар", "Людмила", "Акмарал", "Мария", "Данияр",
         "Аскар", "Зарина", "Олжас", "Индира", "Сергей", "Меруерт", "Асем", "Алексей", "Томирис", "Нургуль", "Ксения",
         "Бауыржан", "Әсел", "Жансая", "Оксана", "Ержан", "Салтанат", "Дмитрий", "Гульмира", "Рауан", "Айнур", "Валерия",
         "Самал", "Кайрат", "Назерке", "Полина", "Әлия", "Темирлан", "Лаура", "Евгения", "Мирас", "Анель", "Роза",
         "Владимир", "Улжан", "Асылжан", "Софья", "Нуржан", "Камшат", "Илья", "Айым", "Диана", "Ринат", "Жулдыз"]
INITIALS = "АБВГДЕЖЗИКЛМНОПРСТУХШЫ"

# Прежние профили p1–p6 сохраняются: на них могут ссылаться избранное и обращения.
FIXED = [
    dict(id="p1", name="Айгерим С.", dir="logoped", city="almaty", formats=["off", "on"], langs=["kk", "ru"], ages=["3-5", "6-9", "10-13"], price=8000, minutes=45, availability="available", about=ABOUT["logoped"][0], exp=9),
    dict(id="p2", name="Марина К.", dir="logoped", city="astana", formats=["on"], langs=["ru"], ages=["0-2", "3-5", "6-9"], price=5000, minutes=40, availability="available", about=EARLY, exp=6),
    dict(id="p3", name="Дана Е.", dir="logoped", city="almaty", formats=["off"], langs=["kk"], ages=["3-5", "6-9"], price=0, minutes=30, availability="available", about=FREE_PED, exp=4),
    dict(id="p4", name="Ольга В.", dir="spec_pedagog", city="shymkent", formats=["off", "on"], langs=["ru"], ages=["6-9", "10-13", "14-17"], price=10000, minutes=60, availability="waitlist", about=ABOUT["spec_pedagog"][0], exp=15),
    dict(id="p5", name="Ерлан Т.", dir="spec_pedagog", city="almaty", formats=["on"], langs=["kk", "ru"], ages=["3-5", "6-9", "10-13"], price=6000, minutes=45, availability="available", about=ABOUT["spec_pedagog"][1], exp=7),
    dict(id="p6", name="Сауле М.", dir="spec_pedagog", city="kostanay", formats=["off"], langs=["kk", "ru"], ages=["0-2", "3-5"], price=4000, minutes=45, availability="available", about=EARLY, exp=11),
]

used_names = {r["name"] for r in FIXED}


def new_name():
    for _ in range(1000):
        n = "%s %s." % (rnd.choice(FIRST), rnd.choice(INITIALS))
        if n not in used_names:
            used_names.add(n)
            return n
    raise RuntimeError("закончились имена")


def price_for(code, cap=None):
    """Цена занятия; cap — верхняя граница (для добора под бюджет)."""
    if cap == 0:
        return 0
    if code in MEDICAL:
        options = [6000, 8000, 9000, 10000, 12000, 15000, 18000, 20000]
    else:
        options = [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000]
    if cap is not None:
        options = [x for x in options if x <= cap] or [cap]
    return rnd.choice(options)


def age_range(code, must=None):
    """Непрерывный диапазон возрастов (индексы AGES), включающий must, если задан."""
    top = 5 if code in ("child_psychologist", "child_psychiatrist", "dietitian", "endocrinologist", "ergotherapist",
                         "rehabilitologist", "lfk_instructor", "audiologist", "ophthalmologist", "ent", "geneticist") else 4
    if must is not None:
        top = max(top, must)
        lo = rnd.randint(max(0, must - 2), must)
        hi = rnd.randint(must, min(top, must + 2))
    else:
        lo = rnd.randint(0, min(3, top - 1))
        hi = rnd.randint(lo + 1, top)
    return AGES[lo:hi + 1]


def about_for(code, ages, price):
    if price == 0:
        return FREE_MED if code in MEDICAL else FREE_PED
    if ages and AGES.index(ages[-1]) <= 1 and code not in MEDICAL:
        return EARLY
    return rnd.choice(ABOUT[code])


def make_profile(code, city, formats, langs, ages, price, availability="available"):
    medical = code in MEDICAL
    return dict(
        id=None, name=new_name(), dir=code, city=city, formats=formats, langs=langs, ages=ages, price=price,
        minutes=rnd.choice([20, 30, 30, 40]) if medical else rnd.choice([30, 40, 45, 45, 60]),
        availability=availability, about=about_for(code, ages, price), exp=rnd.randint(2, 25))


def base_set():
    rows = []
    for code in DIRS:
        for city in CITIES:
            for _ in range(CITY_WEIGHT[city]):
                fmt = rnd.choice([["off"], ["off", "on"], ["off", "on"]] + ([["off"]] if code in MEDICAL else []))
                ages = age_range(code)
                price = price_for(code) if rnd.random() > 0.08 else None  # иногда цена не указана
                rows.append(make_profile(code, city, fmt, rnd.choice([["ru"], ["kk"], ["kk", "ru"], ["kk", "ru"]]), ages, price,
                                         rnd.choice(["available"] * 6 + ["waitlist", "waitlist", "unknown"])))
        for _ in range(3):  # только онлайн, город не указан
            rows.append(make_profile(code, None, ["on"], rnd.choice([["ru"], ["kk"], ["kk", "ru"]]), age_range(code),
                                     price_for(code), rnd.choice(["available"] * 5 + ["waitlist"])))
    return rows


def matches(pr, code, city, age, lang, fmt, budget):
    """Как matchesProfile в bot.mjs, но только для профилей, принимающих обращения."""
    if pr["dir"] != code or pr["availability"] != "available":
        return False
    if age is not None and AGES[age] not in pr["ages"]:
        return False
    if lang is not None and lang not in pr["langs"]:
        return False
    off_ok = "off" in pr["formats"] and city is not None and pr["city"] == city
    on_ok = "on" in pr["formats"]
    if fmt == "off" and not off_ok:
        return False
    if fmt == "on" and not on_ok:
        return False
    if budget is not None and (pr["price"] is None or pr["price"] > budget):
        return False
    return True


def cover(rows):
    added = 0
    for code in DIRS:
        for city in CITIES + [None]:  # None — «Другой город»
            for fmt in ["off", "on"]:
                if fmt == "off" and city is None:
                    continue  # очно в городе, введённом текстом, — по сценарию недоступно
                for age in range(len(AGES)):
                    for lang in LANGS:
                        for budget in BUDGETS:
                            if any(matches(pr, code, city, age, lang, fmt, budget) for pr in rows):
                                continue
                            # Бесплатный (программа фонда / ОСМС) — широкий: оба языка и все возрасты, один на много комбинаций.
                            free = budget == 0
                            langs = ["kk", "ru"] if free else rnd.choice([[lang], ["kk", "ru"]])
                            ages = AGES[:] if free else age_range(code, age)
                            if fmt == "off":
                                p = make_profile(code, city, rnd.choice([["off"], ["off", "on"]]), langs, ages, price_for(code, budget))
                            else:
                                p = make_profile(code, rnd.choice(CITIES + [None]) if rnd.random() < 0.5 else None, ["on"],
                                                 langs, ages, price_for(code, budget))
                                if p["city"] is not None:
                                    p["formats"] = ["off", "on"]
                            rows.append(p)
                            added += 1
    return added


def check(rows):
    """Каждая комбинация (включая «любой язык», «очно или онлайн», «не указывать возраст», без ограничения бюджета)."""
    missing = 0
    total = 0
    for code in DIRS:
        for city in CITIES + [None]:
            for fmt in ["off", "on", "any"]:  # проверка — во всех вариантах, включая «Очно или онлайн»
                for age in list(range(len(AGES))) + [None]:
                    for lang in LANGS + [None]:
                        for budget in [0, 5000, 10000, None]:
                            if fmt == "off" and city is None:
                                continue
                            total += 1
                            fs = ["off", "on"] if fmt == "any" else [fmt]
                            if not any(matches(pr, code, city, age, lang, f, budget) for f in fs for pr in rows):
                                missing += 1
    return total, missing


def make():
    rows = list(FIXED) + base_set()
    added = cover(rows)
    n = 7
    for r in rows:
        if r["id"] is None:
            r["id"] = "p%d" % n
            n += 1
    total, missing = check(rows)
    print("-- профилей: %d (основа %d, добор под покрытие %d); комбинаций проверено: %d, без результата: %d" % (
        len(rows), len(rows) - added, added, total, missing), file=sys.stderr)
    assert missing == 0, "есть комбинации без результата"
    return rows, total


def sql_str(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def sql_arr(a):
    return "array[" + ", ".join(sql_str(x) for x in a) + "]::text[]"


def main():
    rows, total = make()
    print("""-- Расширенный набор демо-профилей специалистов. ВСЕ ДАННЫЕ ВЫМЫШЛЕНЫ.
-- Сгенерировано supabase/demo/gen_specialists.py — правьте генератор, а не этот файл.
-- %d профилей; у каждой из %d комбинаций условий поиска есть хотя бы один специалист, принимающий обращения
-- (кроме «Другой город» + «Очно» — по сценарию там предлагается онлайн).
delete from public.specialists where is_demo;

insert into public.specialists
  (id, display_name, specialty_code, city, formats, languages, age_bands, price_kzt, duration_min, availability,
   experience_years, about, qualifications)
values""" % (len(rows), total))
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
    print(",\n".join(vals) + ";")


if __name__ == "__main__":
    main()
