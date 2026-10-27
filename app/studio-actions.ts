import type { Course, Lesson, StudioAsset, StudioState } from './studio-model';

/** Capture the target when an action is queued, independently of the open course. */
export function targetCourse(courseId: string, update: (course: Course) => Course): (state: StudioState) => StudioState {
  return state => {
    if (!state.courses.some(course => course.id === courseId)) throw new Error('Курс больше недоступен. Обнови студию перед сохранением.');
    return {
      ...state,
      courses: state.courses.map(course => {
        if (course.id !== courseId) return course;
        const next = update(course);
        if (next.id !== courseId) throw new Error('Не удалось определить курс для изменения. Обнови студию.');
        return next;
      }),
    };
  };
}

export function lessonModuleId(course: Course, selectedId: string): string {
  const module = course.modules.find(item => item.id === selectedId) || course.modules[0];
  if (!module) throw new Error('Сначала добавь модуль в программу курса.');
  return module.id;
}

export type StudioUndo = { state: StudioState; revision: number };

export function restoreUndo(snapshot: StudioUndo, currentRevision: number): StudioState {
  if (snapshot.revision !== currentRevision) {
    throw new Error('После этого действия данные студии обновились. Отмена недоступна, чтобы сохранить новые изменения.');
  }
  return structuredClone(snapshot.state);
}

function hasVideoLink(lesson: Lesson): boolean {
  // Match the same first video link that the server uses as a source.
  const link = lesson.links.find(item => /видео|запис/i.test(item.name));
  if (!link) return false;
  try {
    const url = new URL(link.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export type AssetAssignment = Partial<Pick<StudioAsset, 'kind' | 'lessonId'>>;

/** Change only material metadata; keep the file, native ID and original schedule. */
export function reassignAsset(course: Course, assetId: string, patch: AssetAssignment, at = new Date().toISOString()): Course {
  const asset = course.assets.find(item => item.id === assetId);
  if (!asset) throw new Error('Материал больше недоступен. Обнови студию.');
  const nextAsset = { ...asset, ...patch };
  if (nextAsset.lessonId && !course.lessons.some(lesson => lesson.id === nextAsset.lessonId)) throw new Error('Урок для материала больше недоступен. Выбери его заново.');
  if (asset.kind === nextAsset.kind && asset.lessonId === nextAsset.lessonId) return course;

  const lessons = course.lessons.map(lesson => {
    const invalidatesVideo = lesson.videoId === assetId && (nextAsset.kind !== 'video' || nextAsset.lessonId !== lesson.id);
    const touched = lesson.id === asset.lessonId || lesson.id === nextAsset.lessonId || invalidatesVideo;
    if (!touched) return lesson;
    const handedOff = lesson.stage !== 'assembling' || !!lesson.submittedAt;
    if (invalidatesVideo && handedOff && !hasVideoLink(lesson)) {
      throw new Error(`${lesson.code}: комплект уже передан. Сначала выбери другое видео или добавь ссылку «Видео урока» в карточке, затем перенеси материал или измени его тип.`);
    }
    return {
      ...lesson,
      ...(invalidatesVideo ? { videoId: null, timecodesStatus: 'draft' as const } : {}),
      changesPending: lesson.changesPending || handedOff,
      updatedAt: at,
    };
  });
  return { ...course, assets: course.assets.map(item => item.id === assetId ? nextAsset : item), lessons };
}
