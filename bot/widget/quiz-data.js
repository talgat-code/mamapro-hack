"use strict";

// Данные прежнего опроса «Подобрать специалиста» (4 шага) — нужны только виджету-эксперименту.
// Основной бот работает по сценарию mama.md (supabase/functions/_shared/catalog.mjs).
const SPECIALISTS = {
  logoped: { name: "логопед", desc: "помогает развивать речь и коммуникацию ребёнка." },
  defect: { name: "дефектолог", desc: "занимается развитием мышления, внимания и памяти." },
  neuro: { name: "нейропсихолог", desc: "оценивает когнитивные функции и подбирает упражнения." },
  psych: { name: "психолог", desc: "поддерживает эмоционально — ребёнка и всю семью." },
  lfk: { name: "ЛФК-инструктор", desc: "развивает моторику и координацию через движение." },
  aba: { name: "АВА-терапевт", desc: "формирует навыки и поведение поэтапно, в игре." }
};
const AGES = [
  { label: "до 3 лет", value: "до 3" },
  { label: "3–6 лет", value: "3–6" },
  { label: "7–12 лет", value: "7–12" },
  { label: "13+ лет", value: "13+" }
];
const TOPICS = [
  { label: "Речь", value: "речь", rec: ["logoped"] },
  { label: "Поведение и эмоции", value: "поведение и эмоции", rec: ["psych", "aba"] },
  { label: "Обучение и внимание", value: "обучение и внимание", rec: ["neuro", "defect"] },
  { label: "Моторика", value: "моторика", rec: ["lfk"] },
  { label: "Не знаю", value: "не знаю", rec: ["defect"] }
];
const DONT_KNOW = 4;
const FORMATS = [
  { label: "Онлайн", value: "онлайн" },
  { label: "Очно", value: "очно" },
  { label: "Любой", value: "любой" }
];

function recommend(topicIdx) {
  const score = {};
  const order = [];
  topicIdx.forEach(function (ti) {
    const list = TOPICS[ti].rec;
    list.forEach(function (key, i) {
      if (!(key in score)) { score[key] = 0; order.push(key); }
      score[key] += list.length - i;
    });
  });
  order.sort(function (a, b) { return score[b] - score[a]; });
  return { keys: order.slice(0, 2), cut: order.length > 2 };
}

module.exports = { SPECIALISTS, AGES, TOPICS, DONT_KNOW, FORMATS, recommend };
