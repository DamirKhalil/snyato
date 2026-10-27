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

test('LSN filenames normalize lesson numbers without guessing PDF presentation types', () => {
  assert.deepEqual(u.classifyFile('LSN01-Intro.mp4'), { code: 'L01', kind: 'video' });
  assert.deepEqual(u.classifyFile('LSN001_Intro.mp4'), { code: 'L01', kind: 'video' });
  assert.deepEqual(u.classifyFile('LSN01-INTRO.pdf'), { code: 'L01', kind: 'file' });
  assert.deepEqual(u.classifyFile('Модуль 1 — lsn-007_презентация.pdf'), { code: 'L07', kind: 'slides' });
  assert.deepEqual(u.classifyFile('ＬＳＮ００１_Intro.mp4'), { code: 'L01', kind: 'video' });
});

test('LSN codes require Unicode letter/number boundaries and at most four digits', () => {
  for (const name of ['ALSN01-Intro.mp4', '1LSN01-Intro.mp4', 'КLSN01-Intro.mp4', 'LSN01Intro.mp4', 'LSN01А.mp4', 'LSN01٢.mp4', 'LSN12345-Intro.mp4', 'LSN-Intro.mp4']) {
    assert.equal(u.classifyFile(name).code, null, name);
  }
});

test('inventory rerouting binds newly recognized inbox files and preserves valid manual assignments', () => {
  const lessons = [{ id: 'first', code: 'L01' }, { id: 'second', code: 'L02' }];
  const inbox = { name: 'LSN01-Intro.mp4', lessonId: null };
  const assigned = { ...inbox, lessonId: 'second' };
  const snapshots = structuredClone({ lessons, inbox, assigned });
  const route = u.classifyFile(inbox.name);
  assert.equal(u.resolveFileLessonId(inbox.name, route.code, lessons, inbox), 'first');
  assert.equal(u.resolveFileLessonId(assigned.name, route.code, lessons, assigned), 'second');
  assert.equal(u.resolveFileLessonId(inbox.name, route.code, lessons, { ...inbox, lessonId: 'deleted-lesson' }), 'first');
  assert.equal(u.resolveFileLessonId('LSN02-Intro.mp4', 'L02', lessons, { ...inbox, lessonId: 'first' }), 'second');
  assert.equal(u.resolveFileLessonId('Без кода.mp4', null, lessons), null);
  assert.equal(u.resolveFileLessonId('Без кода.mp4', null, lessons, { name: 'Без кода.mp4', lessonId: 'second' }), 'second');
  assert.deepEqual({ lessons, inbox, assigned }, snapshots);
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

test('handoff readiness is video and homework even without dates, plan or slides', () => {
  const course = u.createCourse('Курс', 1, 1), lesson = course.lessons[0];
  lesson.title = 'Урок 1';
  lesson.homework = ['Повторить пример'];
  lesson.slidesRequired = true; lesson.slidesReady = false;
  course.assets.push({ id: 'video-1', name: 'L01.mp4', size: 1024, mime: 'video/mp4', kind: 'video', lessonId: lesson.id, url: 'https://example.test/video.mp4', createdAt: course.createdAt });
  lesson.videoId = 'video-1';
  const before = structuredClone(course);
  assert.deepEqual(u.checkLessonReadiness(course, lesson), []);
  assert.equal(u.getMetrics(course).recorded, 0);
  assert.equal(lesson.recordedOn, null); assert.equal(lesson.submittedAt, null);
  assert.deepEqual(course, before);
  lesson.title = '  ';
  assert.equal(u.checkLessonReadiness(course, lesson).some((item: string) => item.includes('название')), true);
});

test('a selected lesson video or valid named video link is required', () => {
  const course = u.createCourse('Курс', 2, 1), lesson = course.lessons[0];
  lesson.homework = ['Задание'];
  course.assets.push({ id: 'video-1', name: 'L01.mp4', size: 1024, mime: 'video/mp4', kind: 'video', lessonId: course.lessons[1].id, url: 'https://example.test/video.mp4', createdAt: course.createdAt });
  lesson.videoId = 'video-1';
  assert.equal(u.checkLessonReadiness(course, lesson).some((item: string) => item.includes('видео')), true);
  lesson.links = [{ name: 'Видео урока', url: 'https://example.test/final-video' }];
  assert.equal(u.getLessonVideo(course, lesson).asset, null);
  assert.equal(u.getLessonVideo(course, lesson).link.url, lesson.links[0].url);
  assert.deepEqual(u.checkLessonReadiness(course, lesson), []);
  for (const link of [
    { name: 'Материалы', url: 'https://example.test/video.mp4' },
    { name: 'Видео', url: 'javascript:invalid' },
    { name: 'Видео', url: 'https://user:password@example.test/video.mp4' },
  ]) {
    lesson.links = [link];
    assert.equal(u.getLessonVideo(course, lesson).link, null);
  }
});

test('homework accepts text, explicitly typed files or valid named links', () => {
  const course = u.createCourse('Курс', 2, 1), lesson = course.lessons[0];
  lesson.homework = ['  '];
  const attachment = { id: 'homework-1', name: 'L01_homework.pdf', size: 1024, mime: 'application/pdf', kind: 'file', lessonId: lesson.id, url: 'https://example.test/homework.pdf', createdAt: course.createdAt };
  course.assets.push(attachment);
  assert.equal(u.lessonHasHomework(course, lesson), false, 'filename alone does not reinterpret a stored file kind');
  attachment.kind = 'homework';
  assert.equal(u.lessonHasHomework(course, lesson), true);
  assert.deepEqual(u.getHomeworkMaterials(course, lesson).assets, [attachment]);
  attachment.lessonId = course.lessons[1].id;
  assert.equal(u.lessonHasHomework(course, lesson), false);
  for (const name of ['ДЗ', 'Домашнее задание', 'Homework', 'domashnee zadanie']) {
    lesson.links = [{ name, url: 'https://example.test/homework' }];
    assert.equal(u.lessonHasHomework(course, lesson), true, name);
    assert.equal(u.getHomeworkMaterials(course, lesson).links.length, 1);
  }
  lesson.links = [{ name: 'Материал', url: 'https://example.test/homework.pdf' }];
  assert.equal(u.lessonHasHomework(course, lesson), false);
  lesson.links = [{ name: 'ДЗ', url: 'javascript:invalid' }];
  assert.equal(u.lessonHasHomework(course, lesson), false);
  lesson.homework = ['  Сделать упражнение  '];
  assert.deepEqual(u.getHomeworkMaterials(course, lesson).text, ['Сделать упражнение']);
  assert.equal(u.lessonHasHomework(course, lesson), true);
});

test('homework filename markers are explicit and preserve existing routing decisions', () => {
  for (const name of ['L01_ДЗ.pdf', 'Lesson 1-homework.docx', 'LSN01_domashnee_zadanie.pdf', 'L01_Домашнее задание.pdf']) {
    assert.deepEqual(u.classifyFile(name), { code: 'L01', kind: 'homework' }, name);
  }
  for (const name of ['LSN01-INTRO.pdf', 'L01_notes.pdf', 'L01_myhomeworkbook.pdf', 'L01_домашняя библиотека.pdf']) {
    assert.equal(u.classifyFile(name).kind, 'file', name);
  }
  const existing = { name: 'L01_ДЗ.pdf', lessonId: 'manual-lesson' };
  const before = structuredClone(existing);
  assert.equal(u.resolveFileLessonId(existing.name, 'L01', [{ id: 'first', code: 'L01' }, { id: 'manual-lesson', code: 'L02' }], existing), 'manual-lesson');
  assert.deepEqual(existing, before);
});

test('handed-off lessons without optional fact dates do not create recording or preparation tasks', () => {
  const course = u.createCourse('Курс', 4, 1), now = u.today(course.timezone);
  const [ready, taken, published, assembling] = course.lessons;
  ready.stage = 'ready'; taken.stage = 'taken'; published.stage = 'published';
  for (const lesson of [ready, taken, published]) lesson.scheduledDate = u.addDays(now, 1);
  let metrics = u.getMetrics(course);
  assert.equal(metrics.nextLesson, null);
  assert.deepEqual(metrics.prepDue, []);
  assert.deepEqual(metrics.overdueRecords, []);
  assembling.scheduledDate = u.addDays(now, 3);
  metrics = u.getMetrics(course);
  assert.equal(metrics.nextLesson.id, assembling.id);
  assert.deepEqual(metrics.prepDue, []);
  for (const lesson of [ready, taken, published]) lesson.scheduledDate = u.addDays(now, -3);
  metrics = u.getMetrics(course);
  assert.equal(metrics.nextLesson.id, assembling.id);
  assert.deepEqual(metrics.overdueRecords, []);
  assert.deepEqual(metrics.prepDue, []);
  assembling.scheduledDate = u.addDays(now, -3);
  metrics = u.getMetrics(course);
  assert.deepEqual(metrics.overdueRecords.map((lesson: { id: string }) => lesson.id), [assembling.id]);
  assert.deepEqual(metrics.prepDue.map((lesson: { id: string }) => lesson.id), [assembling.id]);
  assert.equal(metrics.recorded, 0);
  assert.equal(metrics.percent, 0);
  assert.equal(metrics.remaining, 4);
  assert.equal(metrics.thisWeek, 0);
  assert.equal(metrics.minutes, 0);
  assert.equal(course.lessons.every((lesson: { recordedOn: string | null }) => lesson.recordedOn === null), true);
});

test('draft timecodes do not block handoff and supplied timecodes are checked only for publishing', () => {
  const course = u.createCourse('Курс', 1, 1), lesson = course.lessons[0];
  lesson.homework = ['Задание'];
  lesson.videoId = 'video-1';
  course.assets.push({ id: 'video-1', name: 'L01.mp4', size: 1024, mime: 'video/mp4', kind: 'video', lessonId: lesson.id, url: 'https://example.test/video.mp4', createdAt: course.createdAt });
  assert.deepEqual(u.checkLessonReadiness(course, lesson, { forPublication: true }), []);
  lesson.timecodes = '00:00 Начало'; lesson.timecodesStatus = 'draft'; lesson.timecodesVideoId = 'old-video';
  assert.deepEqual(u.checkLessonReadiness(course, lesson), []);
  assert.equal(u.checkLessonReadiness(course, lesson, { forPublication: true }).some((item: string) => item.includes('тайм-коды')), true);
  lesson.timecodesStatus = 'checked';
  assert.equal(u.checkLessonReadiness(course, lesson, { forPublication: true }).length, 1);
  lesson.timecodesVideoId = lesson.videoId;
  assert.deepEqual(u.checkLessonReadiness(course, lesson, { forPublication: true }), []);
  lesson.homework = [];
  assert.equal(u.checkLessonReadiness(course, lesson).some((item: string) => item.includes('домашнее задание')), true);
});

console.log(`Passed ${suite.length} domain checks:\n${suite.map(name => '• ' + name).join('\n')}`);
