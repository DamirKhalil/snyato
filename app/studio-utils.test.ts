import assert from 'node:assert/strict';

const u = await import(new URL('./studio-utils.ts', import.meta.url).href);
const suite: string[] = [];
function test(name: string, fn: () => void) { fn(); suite.push(name); }

test('calendar arithmetic crosses leap dates and DST without local-date drift', () => {
  assert.equal(u.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(u.addDays('2026-03-30', -2), '2026-03-28');
  assert.equal(u.addDays('2026-01-01', -2), '2025-12-30');
  assert.throws(() => u.addDays('2026-02-30', 1));
});

test('program imports create stable lessons in explicit modules', () => {
  const course = u.createCourse('Курс', 25, 6, 'Модуль 1. Старт\n1. Введение\n2. Практика\nМодуль 2. Продолжение\n3. Завершение');
  assert.equal(course.modules.length, 2); assert.equal(course.lessons.length, 3);
  assert.equal(course.lessons[0].title, 'Введение');
  assert.equal(course.lessons[2].code, 'L03');
  assert.equal(course.lessons[2].moduleId, course.modules[1].id);
});

test('baseline survives rescheduling and newly added lessons lack original dates', () => {
  const course = u.createCourse('Курс', 2, 1);
  course.lessons[0].scheduledDate = '2026-11-20';
  const locked = u.lockBaseline(course);
  const rescheduled = u.parseCommand(locked, 'Перенеси L01 на 2026-11-22').course;
  assert.equal(rescheduled.lessons[0].baselineDate, '2026-11-20');
  assert.equal(rescheduled.lessons[0].scheduledDate, '2026-11-22');
  assert.equal(u.prepDate(rescheduled.lessons[0]), '2026-11-20');
  const expanded = u.parseCommand(rescheduled, 'Добавь урок: Дополнительная практика').course;
  assert.equal(expanded.lessons[2].baselineDate, null);
  assert.equal(expanded.initialPlannedCount, 2);
  assert.equal(u.lockBaseline(expanded).lessons[0].baselineDate, '2026-11-20');
});

test('homework append and replacement are distinct; command batch is atomic', () => {
  const course = u.createCourse('Курс', 7, 1);
  const first = u.parseCommand(course, 'К L07 добавь ДЗ: Первый пример').course;
  const second = u.parseCommand(first, 'К L07 добавь ДЗ: Второй пример').course;
  assert.equal(second.lessons[6].homework.length, 2);
  const replaced = u.parseCommand(second, 'К L07 замени ДЗ: Новая практика').course;
  assert.deepEqual(replaced.lessons[6].homework, ['Новая практика']);
  assert.deepEqual(course.lessons[6].homework, []);
  assert.throws(() => u.parseCommand(course, 'К L07 добавь ДЗ: Не сохранять\nНепонятная команда'));
  assert.deepEqual(course.lessons[6].homework, []);
});

test('filename routing separates PDF slides, attachments, sources, and video', () => {
  assert.deepEqual(u.classifyFile('Lesson 7_презентация.pdf'), { code: 'L07', kind: 'slides' });
  assert.deepEqual(u.classifyFile('L07_таблица.pdf'), { code: 'L07', kind: 'file' });
  assert.deepEqual(u.classifyFile('L07_исходник.mov'), { code: 'L07', kind: 'source' });
  assert.deepEqual(u.classifyFile('L07_video.mp4'), { code: 'L07', kind: 'video' });
  assert.deepEqual(u.classifyFile('без-кода.pptx'), { code: null, kind: 'slides' });
});

test('recording counts independent of homework and duplicates do not create recordings', () => {
  const course = u.createCourse('Курс', 2, 1);
  course.lessons[0].recordedOn = u.today();
  assert.equal(u.getMetrics(course).recorded, 1);
  course.lessons[0].durationMinutes = 45;
  assert.equal(u.getMetrics(course).minutes, 45);
  assert.equal(u.getMetrics(course).recorded, 1);
  assert.equal(u.checkLessonReadiness(course, course.lessons[0]).some((x: string) => x.includes('видео')), true);
});

test('optional presentation never creates a preparation debt', () => {
  const course = u.createCourse('Курс', 1, 1), lesson = course.lessons[0];
  lesson.scheduledDate = u.addDays(u.today(), 1); lesson.outlineReady = true;
  lesson.slidesRequired = false;
  assert.equal(u.getMetrics(course).prepDue.length, 0);
  lesson.slidesRequired = true;
  assert.equal(u.getMetrics(course).prepDue.length, 1);
});

test('fact date cannot move into future or retrospectively change completed schedule', () => {
  const course = u.createCourse('Курс', 1, 1);
  assert.throws(() => u.parseCommand(course, `L01 записан ${u.addDays(u.today(), 1)}`));
  const recorded = u.parseCommand(course, 'L01 записал сегодня').course;
  assert.equal(recorded.lessons[0].recordedOn, u.today());
  assert.throws(() => u.parseCommand(recorded, 'Перенеси L01 на 2026-11-25'));
});

test('demo is labelled and uses one record per lesson with honest sample data', () => {
  const course = u.createDemoCourse();
  assert.equal(course.isDemo, true); assert.equal(course.lessons.length, 25);
  assert.equal(u.getMetrics(course).recorded, 14);
  assert.equal(u.getMetrics(course).thisWeek, 3);
  assert.equal(u.getMetrics(course).pace, 2.75);
  assert.equal(course.assets.length, 0);
});

test('spoken ordinal, labelled links, and negative readiness preserve meaning', () => {
  const course = u.createCourse('Курс', 7, 1);
  const tasks = u.parseCommand(course, 'К седьмому уроку добавь домашнее задание: Практика').course;
  assert.deepEqual(tasks.lessons[6].homework, ['Практика']);
  const linked = u.parseCommand(tasks, 'К L07 добавь ссылку https://example.com/guide с подписью «Инструкция»').course;
  assert.deepEqual(linked.lessons[6].links, [{ name: 'Инструкция', url: 'https://example.com/guide' }]);
  linked.lessons[6].outlineReady = true;
  const notReady = u.parseCommand(linked, 'К L07 план не готов').course;
  assert.equal(notReady.lessons[6].outlineReady, false);
});

test('constant codes survive reordering while numeric references follow program order', () => {
  const course = u.createCourse('Курс', 2, 1);
  course.lessons[0].order = 1; course.lessons[1].order = 0;
  const byCode = u.parseCommand(course, 'К L01 добавь ДЗ: Постоянный адрес').course;
  assert.equal(byCode.lessons[0].homework.length, 1);
  const byPosition = u.parseCommand(course, 'К уроку 1 добавь ДЗ: Текущая позиция').course;
  assert.equal(byPosition.lessons[1].homework.length, 1);
});

test('delivery deadline is independent of recording, baseline and D−2 preparation', () => {
  const course = u.createCourse('Курс', 7, 1);
  assert.equal(course.lessons[6].deliveryDeadline, null);
  assert.equal(course.lessons[6].submittedAt, null);
  course.lessons[6].scheduledDate = '2026-11-18';
  const locked = u.lockBaseline(course);
  const deadlineSet = u.parseCommand(locked, 'Срок сдачи L07 2026-11-20').course;
  assert.equal(deadlineSet.lessons[6].deliveryDeadline, '2026-11-20');
  const rescheduled = u.parseCommand(deadlineSet, 'Перенеси L07 на 2026-11-22').course;
  assert.equal(rescheduled.lessons[6].deliveryDeadline, '2026-11-20');
  assert.equal(rescheduled.lessons[6].baselineDate, '2026-11-18');
  assert.equal(u.prepDate(rescheduled.lessons[6]), '2026-11-20');
  assert.deepEqual(u.deliveryConflicts(rescheduled).map((lesson: {code:string}) => lesson.code), ['L07']);
  const removed = u.parseCommand(rescheduled, 'Убери дедлайн L07').course;
  assert.equal(removed.lessons[6].deliveryDeadline, null);
  assert.equal(removed.lessons[6].scheduledDate, '2026-11-22');
  const spoken = u.parseCommand(removed, 'К L07 дедлайн 20 ноября').course;
  assert.equal(spoken.lessons[6].deliveryDeadline, `${u.today().slice(0, 4)}-11-20`);
});

test('delivery urgency follows calendar days and does not label today overdue', () => {
  const lesson = u.createLesson('module', 0);
  lesson.deliveryDeadline = '2026-11-20';
  assert.equal(u.getDeliveryStatus(lesson, 'Europe/Moscow', '2026-11-17').kind, 'upcoming');
  assert.equal(u.getDeliveryStatus(lesson, 'Europe/Moscow', '2026-11-18').kind, 'soon');
  assert.equal(u.getDeliveryStatus(lesson, 'Europe/Moscow', '2026-11-20').kind, 'today');
  const overdue = u.getDeliveryStatus(lesson, 'Europe/Moscow', '2026-11-21');
  assert.equal(overdue.kind, 'overdue'); assert.equal(overdue.days, -1);
  assert.equal(u.getDeliveryStatus(lesson, 'Europe/Moscow', '2026-11-19T22:30:00Z').kind, 'today');
  assert.equal(u.getDeliveryStatus(lesson, 'America/New_York', '2026-11-19T22:30:00Z').kind, 'soon');
});

test('handoff timeliness uses actual submission date in the course timezone', () => {
  const lesson = u.createLesson('module', 0);
  lesson.deliveryDeadline = '2026-11-20';
  lesson.submittedAt = '2026-11-20T21:30:00Z';
  lesson.stage = 'taken';
  const inMoscow = u.getDeliveryStatus(lesson, 'Europe/Moscow', '2026-12-01');
  assert.equal(inMoscow.kind, 'late'); assert.equal(inMoscow.days, -1);
  assert.equal(u.getDeliveryStatus(lesson, 'America/New_York', '2026-12-01').kind, 'on_time');
  lesson.submittedAt = '2026-11-20';
  assert.equal(u.getDeliveryStatus(lesson, 'Europe/Moscow', '2026-12-01').kind, 'on_time');
});

test('legacy handed-off lessons keep unknown actual dates and are not overdue again', () => {
  const lesson = u.createLesson('module', 0);
  delete lesson.deliveryDeadline; delete lesson.submittedAt;
  assert.equal(u.getDeliveryStatus(lesson).kind, 'none');
  lesson.deliveryDeadline = '2026-01-01';
  lesson.stage = 'published';
  const status = u.getDeliveryStatus(lesson, 'Europe/Moscow', '2026-11-20');
  assert.equal(status.kind, 'submitted_unknown'); assert.equal(status.days, null);
  assert.equal(lesson.submittedAt, undefined);
  lesson.submittedAt = 'invalid';
  assert.equal(u.getDeliveryStatus(lesson).kind, 'submitted_unknown');
  lesson.submittedAt = '2026-02-30';
  assert.equal(u.getDeliveryStatus(lesson).kind, 'submitted_unknown');
  lesson.submittedAt = '2026-11-20T12:00:00';
  assert.equal(u.getDeliveryStatus(lesson).kind, 'submitted_unknown');
});

test('delivery metrics exclude completed handoffs and sort pending due dates', () => {
  const course = u.createCourse('Курс', 4, 1), now = u.today(course.timezone);
  course.lessons[0].deliveryDeadline = u.addDays(now, -1);
  course.lessons[1].deliveryDeadline = u.addDays(now, 3);
  course.lessons[2].deliveryDeadline = now;
  course.lessons[3].deliveryDeadline = u.addDays(now, -2);
  course.lessons[3].submittedAt = `${u.addDays(now, -1)}T10:00:00Z`;
  course.lessons[3].stage = 'ready';
  const metrics = u.getMetrics(course);
  assert.deepEqual(metrics.overdueDelivery.map((lesson: {code:string}) => lesson.code), ['L01']);
  assert.deepEqual(metrics.upcomingDelivery.map((lesson: {code:string}) => lesson.code), ['L03', 'L02']);
  assert.equal(metrics.nextDelivery.code, 'L03');
  assert.equal(u.getDeliveryStatus(course.lessons[3], course.timezone).kind, 'late');
});

console.log(`Passed ${suite.length} domain checks:\n${suite.map(name => '• ' + name).join('\n')}`);
