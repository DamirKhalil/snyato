import assert from 'node:assert/strict';
import type { Lesson } from './studio-model';

const { mergeLessonDraft } = await import(new URL('./lesson-draft.ts', import.meta.url).href);
const suite: string[] = [];
function test(name: string, fn: () => void) { fn(); suite.push(name); }
function lesson(): Lesson {
  return {
    id: 'lesson-1', code: 'L01', title: 'Урок', moduleId: 'module-1', order: 0,
    outline: 'Исходный план', outlineReady: false, slidesRequired: false, slidesReady: false,
    homework: ['Первое задание'], links: [{ name: 'Пример', url: 'https://example.com' }],
    recordedOn: null, scheduledDate: '2026-10-29', baselineDate: '2026-10-28',
    deliveryDeadline: '2026-11-02', submittedAt: null, durationMinutes: 0,
    stage: 'assembling', assignee: '', takenAt: null, publishedAt: null,
    videoId: null, timecodes: '', timecodesStatus: 'draft', timecodesVideoId: null,
    changesPending: false, updatedAt: '2026-10-26T09:00:00.000Z',
  };
}

test('upload metadata and selected video merge without losing an unsaved lesson plan', () => {
  const base = lesson();
  const local = { ...base, outline: 'План с новым разбором', outlineReady: true };
  const incoming = { ...base, videoId: 'uploaded-video', updatedAt: '2026-10-26T10:00:00.000Z' };
  const { merged, conflicts } = mergeLessonDraft(base, local, incoming);
  assert.deepEqual(conflicts, []);
  assert.equal(merged?.outline, local.outline);
  assert.equal(merged?.outlineReady, true);
  assert.equal(merged?.videoId, incoming.videoId);
  assert.equal(merged?.updatedAt, incoming.updatedAt);
  assert.equal(merged?.deliveryDeadline, base.deliveryDeadline);
  assert.equal(merged?.baselineDate, base.baselineDate);
});

test('independent staff metadata merges with local homework and deadline changes', () => {
  const base = lesson();
  const local = { ...base, homework: [...base.homework, 'Второе задание'], deliveryDeadline: '2026-11-03' };
  const incoming: Lesson = { ...base, stage: 'taken', assignee: 'Специалист', takenAt: '2026-10-26T10:00:00.000Z', changesPending: true };
  const { merged, conflicts } = mergeLessonDraft(base, local, incoming);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(merged?.homework, local.homework);
  assert.equal(merged?.deliveryDeadline, local.deliveryDeadline);
  assert.equal(merged?.stage, 'taken');
  assert.equal(merged?.assignee, 'Специалист');
  assert.equal(merged?.changesPending, true);
});

test('a late normalized save response preserves new edits made after the save finished', () => {
  const saved: Lesson = { ...lesson(), videoId: 'video-1', timecodes: '00:00 Введение', timecodesStatus: 'checked' };
  const nextDraft = { ...saved, outline: 'Новые тезисы после сохранения' };
  const normalizedResponse = { ...saved, timecodesVideoId: 'video-1' };
  const { merged, conflicts } = mergeLessonDraft(saved, nextDraft, normalizedResponse);
  assert.deepEqual(conflicts, []);
  assert.equal(merged?.outline, nextDraft.outline);
  assert.equal(merged?.timecodesVideoId, 'video-1');
  assert.notDeepEqual(merged, normalizedResponse);
});

test('different concurrent outline edits remain an explicit conflict', () => {
  const base = lesson();
  const result = mergeLessonDraft(base, { ...base, outline: 'Мой план' }, { ...base, outline: 'Другой план' });
  assert.equal(result.merged, null);
  assert.deepEqual(result.conflicts, ['outline']);
});

test('concurrent video selections conflict rather than silently replacing a selection', () => {
  const base = { ...lesson(), videoId: 'video-1' };
  const result = mergeLessonDraft(base, { ...base, videoId: 'video-2' }, { ...base, videoId: 'video-3' });
  assert.equal(result.merged, null);
  assert.deepEqual(result.conflicts, ['videoId']);
});

test('recording and rescheduling in different branches require an explicit choice', () => {
  const base = lesson();
  const rescheduled = { ...base, scheduledDate: '2026-10-30' };
  const recorded = { ...base, recordedOn: '2026-10-26' };
  for (const [local, incoming] of [[rescheduled, recorded], [recorded, rescheduled]]) {
    const result = mergeLessonDraft(base, local, incoming);
    assert.equal(result.merged, null);
    assert.ok(result.conflicts.includes('scheduledDate'));
    assert.ok(result.conflicts.includes('recordedOn'));
  }
});

test('reviewed timecodes never merge onto a removed or replaced video', () => {
  const base = { ...lesson(), videoId: 'video-1', timecodes: '00:00 Введение' };
  const reviewed: Lesson = { ...base, timecodesStatus: 'checked', timecodesVideoId: 'video-1' };
  for (const videoId of [null, 'video-2']) {
    const changedSource = { ...base, videoId };
    for (const [local, incoming] of [[reviewed, changedSource], [changedSource, reviewed]]) {
      const result = mergeLessonDraft(base, local, incoming);
      assert.equal(result.merged, null);
      assert.ok(result.conflicts.includes('videoId'));
      assert.ok(result.conflicts.includes('timecodesStatus'));
    }
  }
});

test('a changed video link conflicts with a review of the previous link', () => {
  const base = { ...lesson(), links: [{ name: 'Видео урока', url: 'https://example.com/video-1' }], timecodes: '00:00 Введение' };
  const reviewed: Lesson = { ...base, timecodesStatus: 'checked' };
  const changedSource = { ...base, links: [{ name: 'Видео урока', url: 'https://example.com/video-2' }] };
  const result = mergeLessonDraft(base, reviewed, changedSource);
  assert.equal(result.merged, null);
  assert.ok(result.conflicts.includes('links'));
  assert.ok(result.conflicts.includes('timecodesStatus'));
});

test('editing draft timecodes also conflicts with a source change in the other branch', () => {
  const base = { ...lesson(), videoId: 'video-1', timecodes: '00:00 Введение' };
  const result = mergeLessonDraft(base, { ...base, timecodes: '00:00 Новое введение' }, { ...base, videoId: 'video-2' });
  assert.equal(result.merged, null);
  assert.ok(result.conflicts.includes('timecodes'));
});

test('unrelated resource links can merge with a review of the active video', () => {
  const base = { ...lesson(), videoId: 'video-1', timecodes: '00:00 Введение' };
  const reviewed: Lesson = { ...base, timecodesStatus: 'checked', timecodesVideoId: 'video-1' };
  const withResource = { ...base, links: [...base.links, { name: 'Шаблон', url: 'https://example.com/template' }] };
  const { merged, conflicts } = mergeLessonDraft(base, reviewed, withResource);
  assert.deepEqual(conflicts, []);
  assert.equal(merged?.timecodesStatus, 'checked');
  assert.deepEqual(merged?.links, withResource.links);
});

test('both branches selecting the same new source can retain its explicit review', () => {
  const base = { ...lesson(), videoId: 'video-1', timecodes: '00:00 Введение' };
  const reviewed: Lesson = { ...base, videoId: 'video-2', timecodesStatus: 'checked', timecodesVideoId: 'video-2' };
  const { merged, conflicts } = mergeLessonDraft(base, reviewed, { ...base, videoId: 'video-2' });
  assert.deepEqual(conflicts, []);
  assert.equal(merged?.videoId, 'video-2');
  assert.equal(merged?.timecodesVideoId, 'video-2');
  assert.equal(merged?.timecodesStatus, 'checked');
});

test('identical concurrent edits do not conflict and arrays are merged conservatively', () => {
  const base = lesson();
  const local = { ...base, outline: 'Одинаковый план', homework: ['Моё задание'] };
  const incoming = { ...base, outline: 'Одинаковый план' };
  assert.deepEqual(mergeLessonDraft(base, local, incoming).conflicts, []);
  const conflict = mergeLessonDraft(base, local, { ...incoming, homework: ['Чужое задание'] });
  assert.equal(conflict.merged, null);
  assert.deepEqual(conflict.conflicts, ['homework']);
});

test('merging never mutates or shares nested references with its inputs', () => {
  const base = lesson();
  const local = structuredClone(base);
  local.homework.push('Локальное задание');
  const incoming = { ...structuredClone(base), durationMinutes: 42 };
  const snapshots = [base, local, incoming].map(value => structuredClone(value));
  const { merged } = mergeLessonDraft(base, local, incoming);
  assert.ok(merged);
  merged.homework.push('Изменение результата');
  merged.links[0].name = 'Изменённая ссылка';
  assert.deepEqual([base, local, incoming], snapshots);
});

test('versions of different lessons never merge', () => {
  const base = lesson();
  assert.deepEqual(mergeLessonDraft(base, base, { ...base, id: 'another-lesson' }), { merged: null, conflicts: ['id'] });
});

console.log(`Passed ${suite.length} lesson draft checks.`);
