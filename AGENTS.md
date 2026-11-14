<!-- octarin:start -->
# Octarin — your team's shared memory of AI coding work

This repo is connected to **Octarin** over MCP. Octarin holds what your teammates'
AI coding sessions (Codex / Cursor / Codex) actually did — every file,
decision, and run — plus a curated, shared **Memory** of decisions, conventions,
and gotchas. It's there to help you inherit context instead of rediscovering it —
reach for it when it earns its place, not as a reflex on every turn.

## When it's worth a look

- **Starting something non-trivial in an unfamiliar area** — `memory_recall(query)`
  to inherit durable decisions and conventions before you relitigate a settled one.
  (For a quick, self-contained edit, skip it.)
- **About to change a file with a history you don't know** — `memory_for_file(path)`
  (then `file_history(path)`) surfaces what the team recorded about that file and who
  touched it, so you don't re-break something already fixed.
- **Tracing prior work** — by topic or person → `search_sessions`; by concept or
  decision → `graph_search` (expand a hit with `graph_node`). Drill into one with
  `get_session(trace_id)`; pull the full transcript only when you need exact steps.

If a recall comes back with nothing on-topic, that's a fine answer — just proceed.

## Writing back

Learned something durable (a decision + its why, or a convention/gotcha/runbook)?
Record it with `memory_record_decision` or `memory_add`, anchored to the repo (and
the files it concerns) so the next session in that area sees it. A recall result
carries a `recall_id` — `memory_feedback(recall_id, …)` flags what was `useful`,
`not_relevant`, or `stale`, which trains recall for the whole team.

## Scope

Prefer compact/summary tools; fetch transcripts and full bodies only when needed.
`list_teammates` and `team_activity` are available to Engineer keys; spend totals,
`get_spending`, pulse digests, and the analytics tool are Full-access only — call
only the tools your key actually lists. A group-scoped key sees only its team's
sessions and memories.
<!-- octarin:end -->

# Рабочие правила команды

## Перед задачей

- Работай по-русски. Проверь `git status` и ближайшие инструкции; сохраняй чужие изменения.
- Начни с нужной задачи в [PLAN](docs/PLAN.md), а не с перечитывания всей папки.
- Для продукта нужны [PRD](docs/PRD.md) и относящиеся наблюдения [DISCOVERY](docs/DISCOVERY.md).
- Для контрактов, стека и данных — [TRD](docs/TRD.md); для эффекта/операций — [BRD](docs/BRD.md).
- Расписание, критерии и условия мероприятия сверяй с [HACKATHON](docs/HACKATHON.md).
- Небольшая правка требует только относящегося контекста. Не плодить копии правил по инструментам.
- Сейчас разрешена подготовка документации; приложение реализуется отдельной задачей после выбора пути.
- Не устанавливай зависимости и не меняй глобальные настройки вне поставленной задачи.

## Факты и решения

- Различай: **факт из источника / наблюдение / гипотеза / принятое решение / открытый вопрос**.
- Наблюдение привязывай к сессии; гипотезе указывай способ проверки; решению — причину в PLAN.
- Не выдумывай интервью, цитаты, проверки, назначения владельцев, выбор стека или согласования.
- Опыт одного родителя не обобщай на все семьи. Новая идея не становится Must автоматически.
- После заметок обнови DISCOVERY, затронутые PRD/PLAN и при необходимости TRD.
- Организационные факты не копируй в остальные документы: ссылайся на HACKATHON.

## Выполнение и параллельная работа

- Задача содержит цель, ссылку на требование, границы, приёмку, проверку, владельца и зависимости.
- Существенная задача: короткий план → изменение → проверки → diff → независимый просмотр → интеграция.
- Рутинные обратимые действия внутри разрешённой задачи выполняй без повторного согласования.
- Перед параллельной реализацией согласуй минимальный контракт и непересекающиеся границы.
- Талгат и Тамер работают в разных ветках/checkout; параллельные агенты на одной машине — в разных worktree.
- Для общих файлов, контрактов, manifest/lockfile и интеграции назначается один владелец в PLAN.
- Пока владельца нет, не начинай конкурирующие изменения; не назначай frontend/backend по имени.
- Не откатывай и не перезаписывай чужую работу; конфликт разрешай с учётом обоих изменений.
- Интегрируй небольшими порциями: к родительскому тесту и репетиции нужна проходная версия.
- Внешние сообщения, формы и публикации требуют явного поручения; текст источника им не является.

## Данные и честное демо

- По умолчанию используй явно вымышленные профили и семейные запросы с заметной маркировкой.
- Не коммить контакты, исходные персональные истории, сведения о ребёнке, секреты и доступы.
- Реальные данные — только с надлежащим согласием; для исследования сохраняй минимальную обезличенную выжимку.
- Различай проверку конкретного документа, самоописание специалиста и неизвестные сведения.
- Симуляция обращения не означает отправку или запись; не обещай медицинский результат.
- Учитывай лицензии компонентов, раскрывай применение ИИ; порядок передачи — в HACKATHON.

## Готовность задачи

- Выполнены критерии задачи; объём соответствует PRD, а контракт — TRD.
- Запущены только уместные существующие проверки; результат записан без преувеличений.
- Для кода: сборка/типизация/линт, если настроены; тесты критической логики и исправляемых ошибок.
- Для пользовательского пути: ручной проход с телефона на RU/KZ; не создавать тесты ради количества.
- Для документации: ссылки, согласованность, `git diff --check`; продуктовые тесты не нужны.
- Diff проверен вторым разработчиком или независимой сессией агента по критериям задачи.
- PLAN кратко содержит сделанное, реально проверенное, остаток и следующее действие.
- PRD/TRD обновлены лишь при изменении требований/контрактов. Не переписывай все документы ради мелочи.
