import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import type { Member, StudioResponse, StudioState, StudioUser } from '@/app/studio-model';
import { checkLessonReadiness, getLessonVideo } from '@/app/studio-utils';

const WORKSPACE_ID = 'main';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_STATE_BYTES = 3 * 1024 * 1024;
const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export class StudioError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type WorkspaceRow = {
  id: string; owner_id: string; owner_email: string; owner_name: string;
  state_json: string; revision: number; created_at: string; updated_at: string;
};
type MemberRow = { email: string; name: string; role: string; created_at: string };
export type StudioSession = { workspace: WorkspaceRow; user: StudioUser; members: Member[] };

export function database(): D1Database {
  if (!env.DB) throw new StudioError(503, 'Хранилище ещё запускается. Обнови страницу через несколько секунд.');
  return env.DB;
}

export function bucket(): R2Bucket {
  if (!env.BUCKET) throw new StudioError(503, 'Файловое хранилище пока недоступно.');
  return env.BUCKET;
}

export function checkOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') throw new StudioError(403, 'Запрос должен быть отправлен из студии.');
  if (origin && origin !== new URL(request.url).origin) throw new StudioError(403, 'Недопустимый источник запроса.');
}

export async function readLimited(request: Request, maximum: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw new StudioError(413, maximum === MAX_FILE_BYTES ? 'Файл больше 50 МБ. Для большой записи добавь ссылку на Dropbox.' : 'Слишком большой объём данных.');
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new StudioError(413, maximum === MAX_FILE_BYTES ? 'Файл больше 50 МБ. Для большой записи добавь ссылку на Dropbox.' : 'Слишком большой объём данных.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function readJson(request: Request): Promise<unknown> {
  try { return JSON.parse(new TextDecoder().decode(await readLimited(request, MAX_STATE_BYTES))); }
  catch (error) {
    if (error instanceof StudioError) throw error;
    throw new StudioError(400, 'Не удалось прочитать данные запроса.');
  }
}

export async function requireStudio(): Promise<StudioSession> {
  const identity = await getChatGPTUser();
  if (!identity) throw new StudioError(401, 'Войди через ChatGPT, чтобы открыть студию.');
  const db = database();
  const email = identity.email.toLowerCase().trim();
  let workspace = await db.prepare('SELECT * FROM studio_workspaces WHERE id = ?').bind(WORKSPACE_ID).first<WorkspaceRow>();
  if (!workspace) {
    const now = new Date().toISOString();
    await db.prepare('INSERT INTO studio_workspaces (id, owner_id, owner_email, owner_name, state_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(WORKSPACE_ID, identity.userId, email, identity.displayName, JSON.stringify({ courses: [] }), now, now).run();
    workspace = await db.prepare('SELECT * FROM studio_workspaces WHERE id = ?').bind(WORKSPACE_ID).first<WorkspaceRow>();
  }
  if (!workspace) throw new StudioError(503, 'Не удалось открыть студию. Повтори попытку.');
  const owner = identity.userId === workspace.owner_id;
  const membership = owner ? null : await db.prepare('SELECT * FROM studio_members WHERE email = ?').bind(email).first<MemberRow>();
  if (!owner && !membership) throw new StudioError(403, 'Владелец студии ещё не добавил твою почту в команду.');
  const rows = await db.prepare('SELECT email, name, role, created_at FROM studio_members ORDER BY created_at').all<MemberRow>();
  const members: Member[] = [
    { email: workspace.owner_email, name: workspace.owner_name, role: 'owner', createdAt: workspace.created_at },
    ...rows.results.map(row => ({ email: row.email, name: row.name, role: 'editor' as const, createdAt: row.created_at })),
  ];
  const user: StudioUser = {
    userId: identity.userId, email, displayName: identity.displayName,
    role: owner ? 'owner' : 'editor',
  };
  return { workspace, user, members };
}

export function studioResponse(session: StudioSession, state?: StudioState, revision?: number): Response {
  const payload: StudioResponse = {
    state: state ?? JSON.parse(session.workspace.state_json),
    revision: revision ?? session.workspace.revision,
    user: session.user, members: session.members,
  };
  return Response.json(payload, { headers: noStore });
}

export async function api(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error) {
    if (error instanceof StudioError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
    if (error instanceof z.ZodError) return Response.json({ error: 'Проверь данные: ' + error.issues.slice(0, 3).map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') }, { status: 400, headers: noStore });
    console.error('[studio]', error instanceof Error ? error.message : 'Unexpected error');
    return Response.json({ error: 'Не удалось выполнить действие. Обнови страницу и повтори попытку.' }, { status: 500, headers: noStore });
  }
}

const text = (maximum = 1000) => z.string().max(maximum);
const id = text(200).min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Некорректная дата');
const timestamp = z.string().max(50).refine(value => !Number.isNaN(Date.parse(value)), 'Некорректное время');
const webUrl = z.string().max(4000).refine(value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, 'Нужна ссылка http или https');
const assetUrl = z.union([webUrl, z.string().regex(/^\/api\/assets\/[a-f0-9-]{36}$/)]);
const lessonSchema = z.object({
  id, code: text(50).min(1), title: text(1000), moduleId: id, order: z.number().int().min(0).max(100000),
  outline: text(150000), outlineReady: z.boolean(), slidesRequired: z.boolean(), slidesReady: z.boolean(),
  homework: z.array(text(40000)).max(30), links: z.array(z.object({ name: text(1000), url: webUrl })).max(300),
  recordedOn: date.nullable(), scheduledDate: date.nullable(), baselineDate: date.nullable(),
  deliveryDeadline: date.nullable().optional().default(null), submittedAt: timestamp.nullable().optional().default(null),
  durationMinutes: z.number().finite().min(0).max(10000), stage: z.enum(['assembling', 'ready', 'taken', 'published']),
  assignee: text(1000), takenAt: timestamp.nullable(), publishedAt: timestamp.nullable(), videoId: id.nullable(),
  timecodes: text(150000), timecodesStatus: z.enum(['draft', 'checked']), timecodesVideoId: id.nullable(),
  changesPending: z.boolean(), updatedAt: timestamp,
});
const courseSchema = z.object({
  id, title: text(1000).min(1), subtitle: text(4000), timezone: text(100).refine(value => {
    try { new Intl.DateTimeFormat('ru', { timeZone: value }); return true; } catch { return false; }
  }, 'Неизвестный часовой пояс'), isDemo: z.boolean(), createdAt: timestamp,
  modules: z.array(z.object({ id, title: text(1000) })).min(1).max(200),
  lessons: z.array(lessonSchema).max(3000),
  assets: z.array(z.object({ id, name: text(2000), size: z.number().finite().min(0), mime: text(300), kind: z.enum(['video', 'slides', 'file', 'source', 'outline', 'homework']), lessonId: id.nullable(), url: assetUrl, createdAt: timestamp, fingerprint: text(4000).optional(), source: z.enum(['upload', 'dropbox']).optional(), directLink: z.boolean().optional() })).max(10000),
  baselineLockedAt: timestamp.nullable(), initialPlannedCount: z.number().int().min(0).max(100000),
  history: z.array(z.object({ id, at: timestamp, text: text(10000) })).max(3000),
});
const dropboxSchema = z.object({
  folderId: text(300).regex(/^id:[a-zA-Z0-9_-]+$/), name: text(1000).min(1), path: text(4000).startsWith('/'),
  url: webUrl.refine(value => { try { const parsed = new URL(value); return parsed.protocol === 'https:' && ['dropbox.com', 'www.dropbox.com'].includes(parsed.hostname.toLowerCase()) && (!parsed.port || parsed.port === '443'); } catch { return false; } }, 'Нужна HTTPS-ссылка Dropbox'),
  courseId: id.nullable(), lastSyncedAt: timestamp.nullable(), fileCount: z.number().int().min(0).max(5000),
  lastImportedCount: z.number().int().min(0).max(10000), status: z.enum(['configured', 'synced']),
});
export const stateUpdateSchema = z.object({ state: z.object({ courses: z.array(courseSchema).max(100), dropbox: dropboxSchema.optional() }), revision: z.number().int().min(0) });
export const memberSchema = z.object({ email: z.string().trim().email().max(320), name: text(300).optional().default('') });

export function validateStateRelations(state: StudioState): void {
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) throw new StudioError(400, `Повторяется ${label}.`);
  };
  unique(state.courses.map(course => course.id), 'идентификатор курса');
  for (const course of state.courses) {
    unique(course.modules.map(module => module.id), 'идентификатор модуля');
    unique(course.lessons.map(lesson => lesson.id), 'идентификатор урока');
    unique(course.lessons.map(lesson => lesson.code.toUpperCase()), 'код урока');
    unique(course.assets.map(asset => asset.id), 'идентификатор файла');
    const modules = new Set(course.modules.map(module => module.id));
    const lessons = new Set(course.lessons.map(lesson => lesson.id));
    if (course.lessons.some(lesson => !modules.has(lesson.moduleId))) throw new StudioError(400, 'Урок относится к несуществующему модулю.');
    if (course.assets.some(asset => asset.lessonId !== null && !lessons.has(asset.lessonId))) throw new StudioError(400, 'Файл относится к несуществующему уроку.');
  }
}

function todayInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function sourceIdentity(course: StudioState['courses'][number], lesson: StudioState['courses'][number]['lessons'][number]): Promise<string | null> {
  const { asset, link } = getLessonVideo(course, lesson);
  if (asset) return asset.id;
  if (!link) return null;
  const bytes = new TextEncoder().encode(new URL(link.url).href);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return 'link:' + Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function validateLifecycle(state: StudioState, previous: StudioState): Promise<void> {
  for (const course of state.courses) {
    const oldCourse = previous.courses.find(item => item.id === course.id);
    const today = todayInTimezone(course.timezone);
    if (oldCourse?.baselineLockedAt) {
      if (course.baselineLockedAt !== oldCourse.baselineLockedAt || course.initialPlannedCount !== oldCourse.initialPlannedCount) {
        throw new StudioError(400, 'Первоначальный график уже зафиксирован. Изменяй текущие даты записи.');
      }
      for (const lesson of course.lessons) {
        const old = oldCourse.lessons.find(item => item.id === lesson.id);
        if (lesson.baselineDate !== (old?.baselineDate ?? null)) {
          throw new StudioError(400, `${lesson.code}: первоначальная дата записи сохраняется после утверждения графика.`);
        }
      }
    }
    for (const lesson of course.lessons) {
      const old = oldCourse?.lessons.find(item => item.id === lesson.id);
      if (lesson.recordedOn && lesson.recordedOn > today) {
        throw new StudioError(400, `${lesson.code}: фактическая запись не может находиться в будущем.`);
      }
      if (old?.recordedOn && lesson.scheduledDate !== old.scheduledDate) {
        throw new StudioError(400, `${lesson.code}: урок уже записан. План на момент записи сохраняется; фактическую дату можно исправить отдельно.`);
      }
      // Demo lessons are explicitly labelled fixtures, with no fabricated file uploads.
      if (course.isDemo) continue;
      if (lesson.videoId && !getLessonVideo(course, lesson).asset) lesson.videoId = null;
      const source = await sourceIdentity(course, lesson);
      const oldSource = old && oldCourse ? await sourceIdentity(oldCourse, old) : null;
      if (old && source !== oldSource && old.stage !== 'assembling' && lesson.stage === old.stage) lesson.changesPending = true;
      if (lesson.timecodesStatus === 'checked') {
        if (!lesson.timecodes.trim() || !source) throw new StudioError(400, `${lesson.code}: для проверки тайм-кодов нужна актуальная запись и текст оглавления.`);
        if (lesson.timecodesVideoId === null) {
          // Explicit UI check: bind the reviewed text to the server-computed source.
          lesson.timecodesVideoId = source;
        } else if (lesson.timecodesVideoId !== source) {
          // An old check carried through a file/link edit is no longer valid.
          lesson.timecodesStatus = 'draft';
        }
      }
      if (lesson.stage === old?.stage || lesson.stage === 'assembling') continue;
      const problems = checkLessonReadiness(course, lesson, { forPublication: lesson.stage === 'published' });
      if (problems.length) throw new StudioError(400, `${lesson.code}: ${problems.join('; ')}.`);
    }
  }
}

export function stampTransitions(state: StudioState, previous: StudioState, user: StudioUser): void {
  const now = new Date().toISOString();
  for (const course of state.courses) {
    const oldCourse = previous.courses.find(item => item.id === course.id);
    for (const lesson of course.lessons) {
      const old = oldCourse?.lessons.find(item => item.id === lesson.id);
      // Submission is a first-handoff fact, not an editable deadline or a stage timestamp.
      lesson.submittedAt = old?.submittedAt ?? null;
      if (!lesson.submittedAt && old?.stage === 'assembling' && lesson.stage !== 'assembling') lesson.submittedAt = now;
      lesson.deliveryDeadline ??= null;
      if (old && (old.deliveryDeadline ?? null) !== lesson.deliveryDeadline) {
        course.history.unshift({
          id: crypto.randomUUID(), at: now,
          text: `Срок передачи ${lesson.code}: ${old.deliveryDeadline || 'не назначен'} → ${lesson.deliveryDeadline || 'не назначен'} · ${user.displayName}`,
        });
      }
      if (lesson.stage === 'taken') {
        if (old?.stage !== 'taken') { lesson.assignee = user.displayName; lesson.takenAt = now; }
        else { lesson.assignee = old.assignee; lesson.takenAt = old.takenAt; }
      }
      if (lesson.stage === 'published' && old?.stage !== 'published') lesson.publishedAt = now;
    }
    course.history = course.history.slice(0, 150);
  }
}
