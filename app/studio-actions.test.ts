import assert from 'node:assert/strict';
import type { Course, StudioAsset, StudioState } from './studio-model';

const actions = await import(new URL('./studio-actions.ts', import.meta.url).href);
const utils = await import(new URL('./studio-utils.ts', import.meta.url).href);
const drafts = await import(new URL('./lesson-draft.ts', import.meta.url).href);
const suite: string[] = [];
function test(name: string, run: () => void) { run(); suite.push(name); }
const at = '2026-10-27T09:00:00.000Z';

function fixture(): Course {
  const course = utils.createCourse('Тестовый курс', 3, 1) as Course;
  course.id = 'course-a';
  course.baselineLockedAt = '2026-10-01T09:00:00.000Z';
  course.lessons.forEach((lesson, index) => {
    lesson.baselineDate = `2026-10-${String(index + 21).padStart(2, '0')}`;
    lesson.scheduledDate = `2026-10-${String(index + 24).padStart(2, '0')}`;
    lesson.deliveryDeadline = `2026-11-${String(index + 1).padStart(2, '0')}`;
  });
  const video: StudioAsset = {
    id: 'dropbox:id:test-video', name: 'L01_video.mp4', size: 12000, mime: 'video/mp4', kind: 'video',
    lessonId: course.lessons[0].id, url: 'https://www.dropbox.com/scl/fo/test-folder', createdAt: at,
    fingerprint: 'dropbox:id:test-video:2026-10-24T09:00:00Z:12000', source: 'dropbox', directLink: false,
  };
  course.assets = [video];
  course.lessons[0].videoId = video.id;
  course.lessons[0].timecodes = '00:00 Введение\n03:15 Пример';
  course.lessons[0].timecodesStatus = 'checked';
  course.lessons[0].timecodesVideoId = video.id;
  return course;
}

test('a queued action keeps its original course when the open course changes', () => {
  const first = fixture();
  const second = utils.createCourse('Второй курс', 1, 1) as Course;
  second.id = 'course-b';
  const dropbox = { folderId: 'id:test-folder', name: 'Тестовая папка', path: '/test', url: 'https://www.dropbox.com/scl/fo/test-folder', courseId: first.id, lastSyncedAt: at, fileCount: 1, lastImportedCount: 1, status: 'synced' as const };
  const state: StudioState = { courses: [first, second], dropbox };
  let activeCourse = first.id;
  const queued = actions.targetCourse(activeCourse, (course: Course) => ({ ...course, subtitle: 'Изменение первого курса' }));
  activeCourse = second.id;
  const result = queued(state) as StudioState;
  assert.equal(activeCourse, second.id);
  assert.equal(result.courses[0].subtitle, 'Изменение первого курса');
  assert.equal(result.courses[1], second);
  assert.equal(result.dropbox, dropbox);
  assert.deepEqual(result.courses[0].lessons, first.lessons);
  assert.deepEqual(result.courses[0].assets, first.assets);
});

test('a removed course or an updater with the wrong identity cannot replace another course', () => {
  const course = fixture();
  assert.throws(() => actions.targetCourse('removed', (current: Course) => current)({ courses: [course] }), /недоступен/);
  assert.throws(() => actions.targetCourse(course.id, (current: Course) => ({ ...current, id: 'other' }))({ courses: [course] }), /определить курс/);
  assert.equal(course.id, 'course-a');
});

test('a module from another course falls back to an existing current module', () => {
  const course = fixture();
  const secondModule = { id: 'second-module', title: 'Второй модуль' };
  course.modules.push(secondModule);
  assert.equal(actions.lessonModuleId(course, secondModule.id), secondModule.id);
  assert.equal(actions.lessonModuleId(course, 'another-course-module'), course.modules[0].id);
  assert.throws(() => actions.lessonModuleId({ ...course, modules: [] }, ''), /добавь модуль/);
});

test('moving a selected draft-course video keeps the file and invalidates only its source check', () => {
  const course = fixture();
  const before = structuredClone(course);
  const result = actions.reassignAsset(course, course.assets[0].id, { lessonId: course.lessons[1].id }, at) as Course;
  assert.equal(result.assets.length, 1);
  assert.deepEqual(result.assets[0], { ...before.assets[0], lessonId: course.lessons[1].id });
  assert.equal(result.lessons[0].videoId, null);
  assert.equal(result.lessons[0].timecodesStatus, 'draft');
  assert.equal(result.lessons[0].timecodes, before.lessons[0].timecodes);
  assert.equal(result.lessons[0].timecodesVideoId, before.lessons[0].timecodesVideoId);
  assert.equal(result.lessons[1].videoId, null);
  assert.equal(result.lessons[2], course.lessons[2]);
  result.lessons.forEach((lesson, index) => {
    assert.equal(lesson.baselineDate, before.lessons[index].baselineDate);
    assert.equal(lesson.scheduledDate, before.lessons[index].scheduledDate);
    assert.equal(lesson.deliveryDeadline, before.lessons[index].deliveryDeadline);
    assert.equal(lesson.submittedAt, before.lessons[index].submittedAt);
  });
  assert.equal(result.baselineLockedAt, before.baselineLockedAt);
  assert.equal(result.initialPlannedCount, before.initialPlannedCount);
  assert.deepEqual(course, before);
});

test('changing a selected video type or moving it to the inbox clears its selection without deleting it', () => {
  const course = fixture();
  const retyped = actions.reassignAsset(course, course.assets[0].id, { kind: 'source' }, at) as Course;
  assert.equal(retyped.assets[0].kind, 'source');
  assert.equal(retyped.assets[0].id, course.assets[0].id);
  assert.equal(retyped.lessons[0].videoId, null);
  assert.equal(retyped.lessons[0].timecodesStatus, 'draft');
  const inbox = actions.reassignAsset(course, course.assets[0].id, { lessonId: null }, at) as Course;
  assert.equal(inbox.assets[0].lessonId, null);
  assert.equal(inbox.lessons[0].videoId, null);
});

test('every handed-off stage protects its selected video until another source is chosen', () => {
  for (const stage of ['ready', 'taken', 'published', 'assembling'] as const) {
    const course = fixture();
    course.lessons[0].stage = stage;
    course.lessons[0].submittedAt = '2026-10-25T10:00:00.000Z';
    const before = structuredClone(course);
    assert.throws(() => actions.reassignAsset(course, course.assets[0].id, { lessonId: null }, at), /комплект уже передан/);
    assert.throws(() => actions.reassignAsset(course, course.assets[0].id, { kind: 'file' }, at), /Сначала выбери другое видео/);
    assert.deepEqual(course, before);
  }
});

test('a handed-off lesson with a real fallback video link retains its stage and first handoff', () => {
  const course = fixture();
  course.lessons[0].stage = 'published';
  course.lessons[0].submittedAt = '2026-10-25T10:00:00.000Z';
  course.lessons[0].links = [{ name: 'Видео урока', url: 'https://example.com/lesson-video.mp4' }];
  course.lessons[1].stage = 'ready';
  const result = actions.reassignAsset(course, course.assets[0].id, { lessonId: course.lessons[1].id }, at) as Course;
  assert.equal(result.lessons[0].stage, 'published');
  assert.equal(result.lessons[0].submittedAt, course.lessons[0].submittedAt);
  assert.equal(result.lessons[0].videoId, null);
  assert.equal(result.lessons[0].timecodesStatus, 'draft');
  assert.equal(result.lessons[0].changesPending, true);
  assert.equal(result.lessons[1].changesPending, true);
  assert.deepEqual(result.lessons[0].links, course.lessons[0].links);
});

test('moving an unselected material preserves the reviewed selected video', () => {
  const course = fixture();
  const selected = { ...course.assets[0], id: 'selected-upload', source: 'upload' as const };
  course.assets.push(selected);
  course.lessons[0].videoId = selected.id;
  course.lessons[0].timecodesVideoId = selected.id;
  course.lessons[0].stage = 'taken';
  const result = actions.reassignAsset(course, course.assets[0].id, { lessonId: course.lessons[1].id }, at) as Course;
  assert.equal(result.lessons[0].videoId, selected.id);
  assert.equal(result.lessons[0].timecodesStatus, 'checked');
  assert.equal(result.lessons[0].changesPending, true);
  assert.equal(result.assets[1], selected);
});

test('invalid lesson destinations and unrelated or invalid video links are rejected atomically', () => {
  const course = fixture();
  assert.throws(() => actions.reassignAsset(course, course.assets[0].id, { lessonId: 'missing' }, at), /недоступен/);
  course.lessons[0].stage = 'ready';
  for (const links of [
    [{ name: 'Материал', url: 'https://example.com/video.mp4' }],
    [{ name: 'Видео урока', url: 'javascript:invalid' }],
    [{ name: 'Видео', url: 'invalid' }, { name: 'Запись', url: 'https://example.com/video.mp4' }],
  ]) {
    course.lessons[0].links = links;
    assert.throws(() => actions.reassignAsset(course, course.assets[0].id, { lessonId: null }, at), /комплект уже передан/);
  }
  assert.equal(actions.reassignAsset(course, course.assets[0].id, { kind: 'video' }, at), course);
});

test('a queued command parses the accepted course and retains new files, metadata and lesson edits', () => {
  const before = fixture();
  let instruction = 'К L01 добавь ДЗ: Задание из очереди';
  utils.parseCommand(before, instruction); // Immediate validation must not become the saved course.
  const capturedInstruction = instruction;
  let summary = '';
  const queued = actions.targetCourse(before.id, (course: Course) => {
    const result = utils.parseCommand(course, capturedInstruction);
    summary = result.summary;
    return result.course;
  });
  instruction = 'К L01 поменяй название: Новый текст в поле';
  const accepted = structuredClone(before);
  accepted.lessons[0].title = 'Название из свежей ревизии';
  accepted.lessons[0].homework = ['Задание из предыдущего сохранения'];
  accepted.lessons[1].scheduledDate = '2026-11-10';
  accepted.assets.push({ ...accepted.assets[0], id: 'new-upload', source: 'upload', name: 'Новый материал.pdf', kind: 'file' });
  const dropbox = { folderId: 'id:test-folder', name: 'Тестовая папка', path: '/test', url: 'https://www.dropbox.com/scl/fo/test-folder', courseId: before.id, lastSyncedAt: '2026-10-27T10:00:00.000Z', fileCount: 5, lastImportedCount: 1, status: 'synced' as const };
  const other = { ...fixture(), id: 'other-course' };
  const result = queued({ courses: [accepted, other], dropbox }) as StudioState;
  const course = result.courses[0];
  assert.deepEqual(course.lessons[0].homework, ['Задание из предыдущего сохранения', 'Задание из очереди']);
  assert.equal(course.lessons[0].title, accepted.lessons[0].title);
  assert.equal(course.lessons[1].scheduledDate, '2026-11-10');
  assert.deepEqual(course.assets, accepted.assets);
  assert.equal(result.dropbox, dropbox);
  assert.equal(result.courses[1], other);
  assert.equal(course.baselineLockedAt, before.baselineLockedAt);
  assert.equal(course.lessons[0].baselineDate, before.lessons[0].baselineDate);
  assert.equal(course.lessons[0].deliveryDeadline, before.lessons[0].deliveryDeadline);
  assert.match(summary, /Название из свежей ревизии/);
  assert.equal(course.history[0].text, summary);
});

test('queued editor saves merge an earlier upload without dropping its selected video or metadata', () => {
  const baseCourse = fixture();
  baseCourse.assets = [];
  const base = baseCourse.lessons[0];
  base.videoId = null;
  base.timecodes = '';
  base.timecodesStatus = 'draft';
  base.timecodesVideoId = null;
  const editorBase = structuredClone(base);
  const local = { ...structuredClone(base), outline: 'План из открытого редактора', updatedAt: '2026-10-27T11:00:00.000Z' };
  const queued = actions.targetCourse(baseCourse.id, (course: Course) => {
    const incoming = course.lessons.find(lesson => lesson.id === local.id)!;
    const merge = drafts.mergeLessonDraft(editorBase, { ...local, updatedAt: editorBase.updatedAt }, incoming);
    if (!merge.merged) throw new Error('Урок изменился во время сохранения. Твои правки остались в карточке.');
    return { ...course, lessons: course.lessons.map(lesson => lesson.id === local.id ? { ...merge.merged!, updatedAt: at } : lesson) };
  });
  const accepted = structuredClone(baseCourse);
  const uploaded: StudioAsset = { id: 'new-video-upload', name: 'L01_new.mp4', mime: 'video/mp4', kind: 'video', lessonId: base.id, size: 36000, createdAt: at, source: 'upload', url: '/api/assets/test-upload', fingerprint: 'new-video-fingerprint' };
  accepted.assets.push(uploaded);
  accepted.lessons[0].videoId = uploaded.id;
  accepted.lessons[0].updatedAt = '2026-10-27T10:59:00.000Z';
  const result = queued({ courses: [accepted] }) as StudioState;
  assert.equal(result.courses[0].lessons[0].outline, local.outline);
  assert.equal(result.courses[0].lessons[0].videoId, uploaded.id);
  assert.deepEqual(result.courses[0].assets, [uploaded]);
  assert.equal(result.courses[0].lessons[0].baselineDate, base.baselineDate);
  assert.equal(result.courses[0].lessons[0].deliveryDeadline, base.deliveryDeadline);
  assert.equal(local.videoId, null);
});

test('queued editor saves refuse a conflicting field instead of replacing the accepted lesson', () => {
  const course = fixture();
  const base = structuredClone(course.lessons[0]);
  const local = { ...base, title: 'Мой новый заголовок' };
  course.lessons[0].title = 'Другой сохранённый заголовок';
  const accepted = structuredClone(course);
  const queued = actions.targetCourse(course.id, (current: Course) => {
    const result = drafts.mergeLessonDraft(base, local, current.lessons[0]);
    if (!result.merged) throw new Error('Урок изменился во время сохранения. Твои правки остались в карточке.');
    return { ...current, lessons: [result.merged, ...current.lessons.slice(1)] };
  });
  assert.throws(() => queued({ courses: [course] }), /Твои правки остались/);
  assert.deepEqual(course, accepted);
  assert.equal(local.title, 'Мой новый заголовок');
});

test('undo is bound to its saved revision and cannot overwrite a subsequent accepted change', () => {
  const course = fixture();
  const snapshot = { state: { courses: [course] }, revision: 4 };
  const restored = actions.restoreUndo(snapshot, 4) as StudioState;
  assert.deepEqual(restored, snapshot.state);
  assert.notEqual(restored, snapshot.state);
  assert.throws(() => actions.restoreUndo(snapshot, 5), /Отмена недоступна/);
  restored.courses[0].title = 'Изменённая копия';
  assert.equal(course.title, 'Тестовый курс');
});

console.log(`${suite.length} studio action checks passed.`);
