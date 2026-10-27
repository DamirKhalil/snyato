export type Stage = 'assembling' | 'ready' | 'taken' | 'published';
export type AssetKind = 'video' | 'slides' | 'file' | 'source' | 'outline' | 'homework';
export type StudioAsset = { id: string; name: string; size: number; mime: string; kind: AssetKind; lessonId: string | null; url: string; createdAt: string; fingerprint?: string; source?: 'upload' | 'dropbox'; directLink?: boolean };
export type Lesson = {
  id: string; code: string; title: string; moduleId: string; order: number;
  outline: string; outlineReady: boolean; slidesRequired: boolean; slidesReady: boolean;
  homework: string[]; links: { name: string; url: string }[];
  recordedOn: string | null; scheduledDate: string | null; baselineDate: string | null;
  deliveryDeadline?: string | null; submittedAt?: string | null;
  durationMinutes: number; stage: Stage; assignee: string; takenAt: string | null; publishedAt: string | null;
  videoId: string | null; timecodes: string; timecodesStatus: 'draft' | 'checked'; timecodesVideoId: string | null;
  changesPending: boolean; updatedAt: string;
};
export type Course = {
  id: string; title: string; subtitle: string; timezone: string; isDemo: boolean; createdAt: string;
  modules: { id: string; title: string }[]; lessons: Lesson[]; assets: StudioAsset[];
  baselineLockedAt: string | null; initialPlannedCount: number;
  history: { id: string; at: string; text: string }[];
};
export type DropboxSyncState = { folderId: string; name: string; path: string; url: string; courseId: string | null; lastSyncedAt: string | null; fileCount: number; lastImportedCount: number; status: 'configured' | 'synced' };
export type StudioState = { courses: Course[]; dropbox?: DropboxSyncState };
export type StudioUser = { userId: string; email: string; displayName: string; role: 'owner' | 'editor' };
export type Member = { email: string; name: string; role: 'owner' | 'editor'; createdAt: string };
export type StudioResponse = { state: StudioState; revision: number; user: StudioUser; members: Member[] };
export const STAGE_LABELS: Record<Stage,string> = { assembling: 'Собирается', ready: 'Готов к размещению', taken: 'В работе', published: 'Размещён' };
