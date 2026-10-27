import { env } from 'cloudflare:workers';
import { z } from 'zod';
import type { Course, DropboxSyncState, StudioAsset, StudioState } from '@/app/studio-model';
import { classifyFile, createCourse } from '@/app/studio-utils';
import { database, stateUpdateSchema, StudioError, validateStateRelations } from '@/lib/studio-server';

const dropboxId = z.string().min(4).max(300).regex(/^id:[a-zA-Z0-9_-]+$/);
const cleanText = (max: number) => z.string().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const pathSchema = cleanText(4000).refine(value => value.startsWith('/') && !value.split('/').some(segment => segment === '.' || segment === '..'));
const dropboxUrl = z.string().max(4000).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && ['dropbox.com', 'www.dropbox.com'].includes(url.hostname.toLowerCase()) && !url.username && !url.password && (!url.port || url.port === '443'); }
  catch { return false; }
}, 'Нужна постоянная HTTPS-ссылка Dropbox');
const configSchema = z.object({ folderId: dropboxId, name: cleanText(1000), path: pathSchema, url: dropboxUrl });
export type DropboxConfig = z.infer<typeof configSchema>;
export const snapshotSchema = z.object({
  complete: z.literal(true),
  files: z.array(z.object({
    id: dropboxId.max(180), name: cleanText(1000).refine(value => !/[\/\\]/.test(value)), path: pathSchema,
    size: z.number().int().min(0).max(5 * 1024 ** 4),
    mime: z.string().max(200).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i).optional(),
    modifiedAt: z.string().datetime({ offset: true }), url: dropboxUrl.optional(),
  })).max(5000),
});
export type DropboxSnapshot = z.infer<typeof snapshotSchema>;
type Workspace = { id: string; state_json: string; revision: number };

export async function requireDropboxService(request: Request): Promise<void> {
  const expected = env.STUDIO_SYNC_TOKEN_SHA256;
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) throw new StudioError(503, 'Синхронизация Dropbox ещё не подключена.');
  const bearer = /^Bearer ([^\s]{1,8192})$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!bearer) throw new StudioError(401, 'Требуется служебный доступ к синхронизации.');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer)));
  const actual = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  const normalized = expected.toLowerCase();
  let difference = 0;
  for (let index = 0; index < 64; index++) difference |= actual.charCodeAt(index) ^ normalized.charCodeAt(index);
  if (difference !== 0) throw new StudioError(401, 'Недопустимый служебный доступ.');
}

export function dropboxConfig(): DropboxConfig {
  if (!env.STUDIO_DROPBOX_FOLDER_JSON) throw new StudioError(503, 'Папка Dropbox ещё не выбрана.');
  try { return configSchema.parse(JSON.parse(env.STUDIO_DROPBOX_FOLDER_JSON)); }
  catch { throw new StudioError(503, 'Настройки папки Dropbox нужно проверить.'); }
}

const normalizedPath = (value: string) => value.normalize('NFC').toLowerCase().replace(/\/+$/, '') || '/';
const normalizedTitle = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]/gu, '');

export function validateDropboxSnapshot(input: unknown, config: DropboxConfig): DropboxSnapshot {
  const parsed = snapshotSchema.parse(input);
  const prefix = normalizedPath(config.path) === '/' ? '/' : normalizedPath(config.path) + '/';
  const seen = new Set<string>();
  for (const file of parsed.files) {
    if (seen.has(file.id)) throw new StudioError(400, 'В снимке Dropbox повторяется идентификатор файла.');
    seen.add(file.id);
    if (!normalizedPath(file.path).startsWith(prefix)) throw new StudioError(400, 'Файл находится за пределами выбранной папки Dropbox.');
    const filename = file.path.split('/').at(-1) || '';
    if (filename.normalize('NFC').toLowerCase() !== file.name.normalize('NFC').toLowerCase()) throw new StudioError(400, 'Имя файла не совпадает с его путём Dropbox.');
  }
  return parsed;
}

function selectedCourse(state: StudioState, config: DropboxConfig): Course | null {
  if (state.dropbox?.folderId === config.folderId && state.dropbox.courseId) {
    const bound = state.courses.find(course => course.id === state.dropbox!.courseId);
    if (bound) return bound;
  }
  const matches = state.courses.filter(course => !course.isDemo && normalizedTitle(course.title) === normalizedTitle(config.name));
  return matches.length === 1 ? matches[0] : null;
}

export function dropboxStatus(state: StudioState, config: DropboxConfig): DropboxSyncState {
  const retained = state.dropbox?.folderId === config.folderId ? state.dropbox : undefined;
  return {
    ...config, courseId: selectedCourse(state, config)?.id || null,
    lastSyncedAt: retained?.lastSyncedAt || null, fileCount: retained?.fileCount || 0,
    lastImportedCount: retained?.lastImportedCount || 0, status: retained?.status || 'configured',
  };
}

const mimeTypes: Record<string, string> = {
  pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', txt: 'text/plain', zip: 'application/zip',
};

export function mergeDropboxSnapshot(state: StudioState, config: DropboxConfig, snapshot: DropboxSnapshot, at = new Date().toISOString()) {
  const next = structuredClone(state);
  let course = selectedCourse(next, config);
  if (!course && !next.courses.length) { course = createCourse(config.name, 25, 6); next.courses.push(course); }
  if (!course) throw new StudioError(400, 'Выбери курс для папки Dropbox в настройках студии. Совпадение по названию не найдено или неоднозначно.');
  let addedCount = 0, updatedCount = 0;
  const touched = new Set<string>();
  const changedContent = new Set<string>();
  for (const file of snapshot.files) {
    const id = 'dropbox:' + file.id;
    const index = course.assets.findIndex(asset => asset.id === id);
    const old = index === -1 ? undefined : course.assets[index];
    const route = classifyFile(file.name);
    const lessonId = course.lessons.find(lesson => lesson.code.toUpperCase() === route.code?.toUpperCase())?.id
      || (old?.name === file.name ? old.lessonId : null) || null;
    const fingerprint = 'dropbox:' + file.id + ':' + file.modifiedAt + ':' + file.size;
    const asset: StudioAsset = {
      id, name: file.name, size: file.size, mime: file.mime || mimeTypes[file.name.split('.').at(-1)?.toLowerCase() || ''] || 'application/octet-stream',
      kind: old?.name === file.name ? old.kind : route.kind, lessonId, url: file.url || config.url,
      createdAt: old?.createdAt || at, fingerprint, source: 'dropbox', directLink: !!file.url && file.url !== config.url,
    };
    if (!old) { course.assets.push(asset); addedCount++; }
    else if (JSON.stringify(old) !== JSON.stringify(asset)) { course.assets[index] = asset; updatedCount++; }
    else continue;
    if (old?.lessonId) touched.add(old.lessonId);
    if (lessonId) touched.add(lessonId);
    if (old && old.fingerprint !== fingerprint) changedContent.add(id);
  }
  for (const lesson of course.lessons) {
    const oldVideoId = lesson.videoId;
    if (lesson.videoId && !course.assets.some(asset => asset.id === lesson.videoId && asset.lessonId === lesson.id && asset.kind === 'video')) lesson.videoId = null;
    if (!lesson.videoId) lesson.videoId = course.assets.find(asset => asset.lessonId === lesson.id && asset.kind === 'video')?.id || null;
    if (oldVideoId !== lesson.videoId || (lesson.videoId && changedContent.has(lesson.videoId))) {
      lesson.timecodesStatus = 'draft';
      touched.add(lesson.id);
    }
    if (touched.has(lesson.id)) {
      lesson.updatedAt = at;
      if (lesson.stage !== 'assembling') lesson.changesPending = true;
    }
  }
  if (addedCount || updatedCount) {
    course.history.unshift({ id: crypto.randomUUID(), at, text: `Dropbox: добавлено ${addedCount}, обновлено ${updatedCount}.` });
    course.history = course.history.slice(0, 150);
  }
  next.dropbox = { ...config, courseId: course.id, lastSyncedAt: at, fileCount: snapshot.files.length, lastImportedCount: addedCount + updatedCount, status: 'synced' };
  return { state: next, addedCount, updatedCount, importedCount: addedCount + updatedCount };
}

export async function readDropboxWorkspace(): Promise<Workspace | null> {
  return database().prepare('SELECT id, state_json, revision FROM studio_workspaces WHERE id = ?').bind('main').first<Workspace>();
}

export async function saveDropboxSnapshot(snapshot: DropboxSnapshot, config: DropboxConfig) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readDropboxWorkspace();
    if (!row) throw new StudioError(409, 'Сначала открой студию под аккаунтом владельца.');
    const result = mergeDropboxSnapshot(JSON.parse(row.state_json) as StudioState, config, snapshot);
    const validated = stateUpdateSchema.parse({ state: result.state, revision: row.revision }).state;
    validateStateRelations(validated);
    const update = await database().prepare('UPDATE studio_workspaces SET state_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
      .bind(JSON.stringify(validated), new Date().toISOString(), row.id, row.revision).run();
    if (update.meta.changes) return { ok: true, dropbox: validated.dropbox, revision: row.revision + 1, addedCount: result.addedCount, updatedCount: result.updatedCount, importedCount: result.importedCount };
  }
  throw new StudioError(409, 'Данные студии меняются параллельно. Повтори синхронизацию позже.');
}
