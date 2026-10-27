import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { Course, StudioState } from '../app/studio-model';

// Exercise the real server and route; only platform bindings and identity are local.
const runtimeKey = Symbol.for('snyato.studio-server.test');
const globals = globalThis as unknown as Record<symbol, unknown>;
const runtime = { env: {} as { DB?: D1Database }, identity: null as null | { userId: string; email: string; displayName: string } };
globals[runtimeKey] = runtime;
const moduleUrl = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') return { url: moduleUrl('export const env = globalThis[Symbol.for("snyato.studio-server.test")].env;'), shortCircuit: true };
    if (specifier === '@/app/chatgpt-auth') return { url: moduleUrl('export async function getChatGPTUser() { return globalThis[Symbol.for("snyato.studio-server.test")].identity; }'), shortCircuit: true };
    if (specifier.startsWith('@/')) return { url: new URL('../' + specifier.slice(2) + '.ts', import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const server = await import(new URL('./studio-server.ts', import.meta.url).href);
const route = await import(new URL('../app/api/studio/route.ts', import.meta.url).href);
const utils = await import(new URL('../app/studio-utils.ts', import.meta.url).href);
const drafts = await import(new URL('../app/lesson-draft.ts', import.meta.url).href);
const suite: string[] = [];
async function test(name: string, run: () => void | Promise<void>) { await run(); suite.push(name); }
const at = '2026-01-01T09:00:00.000Z';
const owner = { userId: 'owner-user', email: 'owner@example.test', displayName: 'Автор' };
const editor = { userId: 'editor-user', email: 'editor@example.test', displayName: 'Техспециалист' };

function fixture(): StudioState {
  const course = utils.createCourse('Тестовый курс', 1, 1) as Course;
  const lesson = course.lessons[0];
  lesson.title = 'Практическое введение';
  lesson.homework = ['Повторить пример на своей задаче.'];
  lesson.deliveryDeadline = '2026-12-20';
  course.baselineLockedAt = at;
  lesson.baselineDate = '2026-01-10';
  lesson.videoId = 'video-1';
  course.assets = [{ id: 'video-1', name: 'L01_video.mp4', size: 1024, mime: 'video/mp4', kind: 'video', lessonId: lesson.id, url: 'https://example.test/video.mp4', createdAt: at }];
  return { courses: [course], dropbox: { folderId: 'id:test-folder', name: 'Тестовая папка', path: '/test', url: 'https://www.dropbox.com/scl/fo/test-folder', courseId: course.id, lastSyncedAt: at, fileCount: 1, lastImportedCount: 1, status: 'synced' } };
}

type Workspace = { id: string; owner_id: string; owner_email: string; owner_name: string; state_json: string; revision: number; created_at: string; updated_at: string };
class MemoryStudioDb {
  workspace: Workspace;
  members = [{ email: editor.email, name: editor.displayName, role: 'editor', created_at: at }];
  updates = 0;
  concurrentState: StudioState | null = null;
  constructor(state = fixture()) {
    this.workspace = { id: 'main', owner_id: owner.userId, owner_email: owner.email, owner_name: owner.displayName, state_json: JSON.stringify(state), revision: 7, created_at: at, updated_at: at };
  }
  prepare(sql: string) {
    let values: unknown[] = [];
    const query = {
      bind(...args: unknown[]) { values = args; return query; },
      first: async () => {
        if (sql.includes('FROM studio_workspaces')) return structuredClone(this.workspace);
        if (sql.includes('FROM studio_members')) return structuredClone(this.members.find(member => member.email === values[0]) || null);
        throw new Error('Unexpected test query: ' + sql);
      },
      all: async () => ({ results: structuredClone(this.members) }),
      run: async () => {
        if (!sql.startsWith('UPDATE studio_workspaces')) throw new Error('Unexpected test mutation: ' + sql);
        if (this.concurrentState) {
          this.workspace.state_json = JSON.stringify(this.concurrentState);
          this.workspace.revision++;
          this.concurrentState = null;
        }
        if (values[2] !== this.workspace.id || values[3] !== this.workspace.revision) return { meta: { changes: 0 } };
        this.workspace.state_json = String(values[0]);
        this.workspace.updated_at = String(values[1]);
        this.workspace.revision++;
        this.updates++;
        return { meta: { changes: 1 } };
      },
    };
    return query;
  }
}

function session(state = fixture(), identity: typeof owner | null = owner) {
  const db = new MemoryStudioDb(state);
  runtime.env.DB = db as unknown as D1Database;
  runtime.identity = identity;
  return db;
}
function put(state: StudioState, revision = 7) {
  return route.PUT(new Request('https://snyato.test/api/studio', { method: 'PUT', headers: { origin: 'https://snyato.test', 'content-type': 'application/json' }, body: JSON.stringify({ state, revision }) }));
}
function assertStamped(value: string | null | undefined, before: number, after: number) {
  assert.ok(value, 'server timestamp must be present');
  const parsed = Date.parse(value!);
  assert.ok(parsed >= before && parsed <= after, 'timestamp must come from this server operation');
}

await test('video and homework permit handoff without recording date, plan or slides', async () => {
  const previous = fixture(), next = structuredClone(previous);
  next.courses[0].lessons[0].stage = 'ready';
  await server.validateLifecycle(next, previous);
  assert.equal(next.courses[0].lessons[0].recordedOn, null);
  assert.equal(next.courses[0].lessons[0].outlineReady, false);
  assert.equal(next.courses[0].lessons[0].slidesReady, false);
  assert.deepEqual(next.courses[0].assets, previous.courses[0].assets);
});

await test('existing generic lesson titles and draft optional timecodes do not block handoff', async () => {
  const previous = fixture(), next = structuredClone(previous), lesson = next.courses[0].lessons[0];
  lesson.title = 'Урок 1'; lesson.timecodes = '00:00 Введение'; lesson.timecodesStatus = 'draft'; lesson.stage = 'ready';
  await server.validateLifecycle(next, previous);
  assert.equal(lesson.stage, 'ready');
  assert.equal(lesson.timecodesStatus, 'draft');
  assert.deepEqual(next.dropbox, previous.dropbox);
});

await test('missing video or homework still blocks handoff', async () => {
  for (const missing of ['video', 'homework']) {
    const previous = fixture(), next = structuredClone(previous), lesson = next.courses[0].lessons[0];
    lesson.stage = 'ready';
    if (missing === 'video') lesson.videoId = null;
    else lesson.homework = ['  '];
    await assert.rejects(server.validateLifecycle(next, previous), (error: { status?: number }) => error.status === 400);
  }
});

await test('homework file and named homework link satisfy the same handoff contract', async () => {
  for (const format of ['file', 'link']) {
    const previous = fixture(), next = structuredClone(previous), course = next.courses[0], lesson = course.lessons[0];
    lesson.stage = 'ready'; lesson.homework = [];
    if (format === 'file') course.assets.push({ id: 'homework-1', name: 'L01_homework.pdf', size: 512, mime: 'application/pdf', kind: 'homework', lessonId: lesson.id, url: 'https://example.test/homework.pdf', createdAt: at });
    else lesson.links = [{ name: 'Домашнее задание', url: 'https://example.test/homework' }];
    const parsed = server.stateUpdateSchema.parse({ state: next, revision: 7 }).state;
    await server.validateLifecycle(parsed, previous);
    assert.equal(parsed.courses[0].lessons[0].stage, 'ready');
    assert.deepEqual(previous.courses[0].lessons[0].homework, ['Повторить пример на своей задаче.']);
  }
});

await test('an ordinary PDF attachment does not silently become homework', async () => {
  const previous = fixture(), next = structuredClone(previous), course = next.courses[0], lesson = course.lessons[0];
  lesson.stage = 'ready'; lesson.homework = [];
  course.assets.push({ id: 'attachment-1', name: 'L01_notes.pdf', size: 512, mime: 'application/pdf', kind: 'file', lessonId: lesson.id, url: 'https://example.test/notes.pdf', createdAt: at });
  await assert.rejects(server.validateLifecycle(next, previous), (error: { status?: number }) => error.status === 400);
});

await test('first claim uses authenticated actor and server time, preserving all course facts', () => {
  const previous = fixture(), next = structuredClone(previous), lesson = next.courses[0].lessons[0];
  lesson.stage = 'taken';
  lesson.assignee = 'Подставное имя';
  lesson.takenAt = at;
  lesson.submittedAt = at;
  const before = Date.now();
  server.stampTransitions(next, previous, { ...editor, role: 'editor' });
  const after = Date.now();
  assert.equal(lesson.assignee, editor.displayName);
  assertStamped(lesson.takenAt, before, after);
  assertStamped(lesson.submittedAt, before, after);
  assert.equal(lesson.takenAt, lesson.submittedAt);
  for (const key of ['recordedOn', 'scheduledDate', 'baselineDate', 'deliveryDeadline', 'publishedAt', 'videoId'] as const) assert.equal(lesson[key], previous.courses[0].lessons[0][key]);
  assert.equal(next.courses[0].baselineLockedAt, previous.courses[0].baselineLockedAt);
  assert.equal(next.courses[0].initialPlannedCount, previous.courses[0].initialPlannedCount);
  assert.deepEqual(next.courses[0].assets, previous.courses[0].assets);
  assert.deepEqual(next.dropbox, previous.dropbox);
});

await test('repeated taken save cannot replace claim or first submission', () => {
  const previous = fixture(), old = previous.courses[0].lessons[0];
  old.stage = 'taken'; old.assignee = 'Первый специалист'; old.takenAt = at; old.submittedAt = at;
  const next = structuredClone(previous), lesson = next.courses[0].lessons[0];
  lesson.assignee = 'Замена'; lesson.takenAt = '2026-02-01T00:00:00Z'; lesson.submittedAt = null;
  server.stampTransitions(next, previous, { ...owner, role: 'owner' });
  assert.equal(lesson.assignee, old.assignee);
  assert.equal(lesson.takenAt, at);
  assert.equal(lesson.submittedAt, at);
});

await test('resubmission and publication preserve the first handoff', () => {
  const previous = fixture(), old = previous.courses[0].lessons[0];
  old.submittedAt = at;
  const next = structuredClone(previous), lesson = next.courses[0].lessons[0];
  lesson.stage = 'ready'; lesson.submittedAt = null;
  server.stampTransitions(next, previous, { ...owner, role: 'owner' });
  assert.equal(lesson.submittedAt, at);
  const published = structuredClone(next), publishedLesson = published.courses[0].lessons[0];
  publishedLesson.stage = 'published'; publishedLesson.publishedAt = at;
  const before = Date.now();
  server.stampTransitions(published, next, { ...editor, role: 'editor' });
  assert.equal(publishedLesson.submittedAt, at);
  assertStamped(publishedLesson.publishedAt, before, Date.now());
});

await test('legacy handed-off records never acquire a fabricated submission date', () => {
  const previous = fixture(), old = previous.courses[0].lessons[0];
  old.stage = 'ready'; delete old.submittedAt;
  const next = structuredClone(previous), lesson = next.courses[0].lessons[0];
  lesson.stage = 'taken'; lesson.submittedAt = at;
  server.stampTransitions(next, previous, { ...editor, role: 'editor' });
  assert.equal(lesson.submittedAt, null);
  assert.equal(utils.getDeliveryStatus(lesson).kind, 'submitted_unknown');
});

await test('legacy schema input without submission or deadline remains compatible', () => {
  const state = fixture(), lesson = state.courses[0].lessons[0];
  lesson.stage = 'taken'; delete lesson.submittedAt; delete lesson.deliveryDeadline;
  const parsed = server.stateUpdateSchema.parse({ state, revision: 7 }).state;
  assert.equal(parsed.courses[0].lessons[0].submittedAt, null);
  assert.equal(parsed.courses[0].lessons[0].deliveryDeadline, null);
  assert.equal(parsed.courses[0].lessons[0].stage, 'taken');
  assert.deepEqual(parsed.courses[0].assets, state.courses[0].assets);
});

await test('publication permits absent timecodes but rejects supplied unreviewed or stale ones', async () => {
  for (const mode of ['absent', 'unreviewed', 'stale', 'reviewed']) {
    const previous = fixture(), old = previous.courses[0].lessons[0];
    old.stage = 'taken'; old.submittedAt = at;
    const db = session(previous, editor), next = structuredClone(previous), lesson = next.courses[0].lessons[0];
    lesson.stage = 'published';
    if (mode !== 'absent') lesson.timecodes = '00:00 Введение';
    if (mode === 'stale') { lesson.timecodesStatus = 'checked'; lesson.timecodesVideoId = 'previous-video'; }
    if (mode === 'reviewed') { lesson.timecodesStatus = 'checked'; lesson.timecodesVideoId = null; }
    const response = await put(next);
    assert.equal(response.status, mode === 'absent' || mode === 'reviewed' ? 200 : 400, mode);
    assert.equal(db.updates, mode === 'absent' || mode === 'reviewed' ? 1 : 0, mode);
    if (response.ok) {
      const saved = (await response.json()).state.courses[0].lessons[0];
      assert.equal(saved.submittedAt, at);
      assert.equal(saved.recordedOn, null);
      if (mode === 'reviewed') assert.equal(saved.timecodesVideoId, 'video-1');
    }
  }
});

await test('video link fallback normalizes a missing selection and invalidates review after URL change', async () => {
  const previous = fixture(), next = structuredClone(previous), lesson = next.courses[0].lessons[0];
  lesson.videoId = 'removed-video';
  lesson.links = [{ name: 'Видео урока', url: 'https://example.test/replacement-video' }];
  lesson.timecodes = '00:00 Введение'; lesson.timecodesStatus = 'checked'; lesson.timecodesVideoId = null;
  lesson.stage = 'ready';
  await server.validateLifecycle(next, previous);
  assert.equal(lesson.videoId, null);
  assert.match(lesson.timecodesVideoId!, /^link:[a-f0-9]{64}$/);
  const changed = structuredClone(next), changedLesson = changed.courses[0].lessons[0];
  changedLesson.stage = 'published'; changedLesson.links[0].url = 'https://example.test/new-video';
  await assert.rejects(server.validateLifecycle(changed, next), (error: { status?: number }) => error.status === 400);
  assert.equal(changedLesson.timecodesStatus, 'draft');
});

await test('concurrent named-video replacement cannot inherit local timecode review', () => {
  for (const name of ['Видео урока', 'Video']) {
    const state = fixture(), base = state.courses[0].lessons[0];
    base.videoId = null; base.links = [{ name, url: 'https://example.test/video-a' }];
    base.timecodes = '00:00 Введение'; base.timecodesStatus = 'draft'; base.timecodesVideoId = null;
    const local = structuredClone(base), incoming = structuredClone(base);
    local.timecodesStatus = 'checked';
    incoming.links[0].url = 'https://example.test/video-b';
    const result = drafts.mergeLessonDraft(base, local, incoming);
    assert.equal(result.merged, null, `${name}: a review must stay with its original video`);
    assert.ok(result.conflicts.includes('links'));
  }
});

await test('anonymous and unlisted identities cannot read the studio', async () => {
  const db = session(fixture(), null);
  assert.equal((await route.GET()).status, 401);
  runtime.identity = { userId: 'stranger-user', email: 'stranger@example.test', displayName: 'Посторонний' };
  assert.equal((await route.GET()).status, 403);
  assert.equal((await put(fixture())).status, 403);
  assert.equal(db.updates, 0);
});

await test('listed technician can claim a complete lesson through the real PUT route', async () => {
  const previous = fixture(), db = session(previous, editor), next = structuredClone(previous), lesson = next.courses[0].lessons[0];
  lesson.stage = 'taken'; lesson.assignee = owner.displayName; lesson.takenAt = at; lesson.submittedAt = at;
  const before = Date.now(), response = await put(next);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.revision, 8);
  assert.equal(body.user.role, 'editor');
  const saved = body.state.courses[0].lessons[0];
  assert.equal(saved.assignee, editor.displayName);
  assertStamped(saved.takenAt, before, Date.now());
  assertStamped(saved.submittedAt, before, Date.now());
  assert.equal(saved.recordedOn, null);
  assert.equal(saved.baselineDate, lesson.baselineDate);
  assert.equal(saved.deliveryDeadline, lesson.deliveryDeadline);
  assert.deepEqual(body.state.dropbox, previous.dropbox);
  assert.equal(db.updates, 1);
});

await test('stale revision is rejected before writing state', async () => {
  const state = fixture(), db = session(state), before = db.workspace.state_json;
  const response = await put(state, 6);
  assert.equal(response.status, 409);
  assert.equal(db.updates, 0);
  assert.equal(db.workspace.state_json, before);
});

await test('CAS rejects a concurrent write accepted after the initial revision check', async () => {
  const state = fixture(), db = session(state), concurrent = structuredClone(state);
  concurrent.courses[0].subtitle = 'Изменено в другом окне';
  db.concurrentState = concurrent;
  const response = await put(state);
  assert.equal(response.status, 409);
  assert.equal(db.updates, 0);
  assert.equal(db.workspace.revision, 8);
  assert.deepEqual(JSON.parse(db.workspace.state_json), concurrent);
});

await test('origin guard rejects cross-site state writes', async () => {
  const db = session();
  const response = await route.PUT(new Request('https://snyato.test/api/studio', { method: 'PUT', headers: { origin: 'https://other.test', 'content-type': 'application/json' }, body: JSON.stringify({ state: fixture(), revision: 7 }) }));
  assert.equal(response.status, 403);
  assert.equal(db.updates, 0);
});

hooks.deregister();
delete globals[runtimeKey];
console.log(`Passed ${suite.length} studio server tests`);
suite.forEach(name => console.log('✓ ' + name));
