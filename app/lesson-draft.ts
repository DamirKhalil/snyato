import type { Lesson } from './studio-model';

type MergeResult = { merged: Lesson | null; conflicts: (keyof Lesson)[] };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const timecodeFields: (keyof Lesson)[] = ['timecodes', 'timecodesStatus', 'timecodesVideoId'];

function videoSource(lesson: Lesson): string | null {
  // Keep the named-link marker and URL rules aligned with getLessonVideo.
  // This pure merge has no course assets: retain both candidates so a dangling
  // selected ID cannot hide a concurrent edit of its fallback video link.
  let videoLink: string | null = null;
  for (const link of lesson.links) {
    if (!/(?:видео|запис|(?:^|[^\p{L}\p{N}])video(?=$|[^\p{L}\p{N}]))/iu.test(link.name)) continue;
    try {
      const url = new URL(link.url);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
        videoLink = url.href;
        break;
      }
    } catch { /* An invalid earlier link must not hide a later valid one. */ }
  }
  return lesson.videoId || videoLink ? JSON.stringify([lesson.videoId, videoLink]) : null;
}

/** Merge independent field changes; arrays remain atomic to avoid guessing at edits. */
export function mergeLessonDraft(base: Lesson, local: Lesson, incoming: Lesson): MergeResult {
  if (base.id !== local.id || base.id !== incoming.id) return { merged: null, conflicts: ['id'] };

  const merged = structuredClone(incoming);
  const conflicts: (keyof Lesson)[] = [];
  const keys = Object.keys({ ...base, ...local, ...incoming }) as (keyof Lesson)[];
  function keepLocal<K extends keyof Lesson>(key: K) { merged[key] = structuredClone(local[key]); }

  for (const key of keys) {
    if (same(local[key], base[key])) continue;
    if (same(incoming[key], base[key]) || same(local[key], incoming[key])) keepLocal(key);
    else conflicts.push(key);
  }

  // A recording fixes its planned date. Two individually valid edits may violate
  // that invariant when one records the lesson and the other reschedules it.
  const localRecordingChanged = !same(local.recordedOn, base.recordedOn);
  const incomingRecordingChanged = !same(incoming.recordedOn, base.recordedOn);
  if (local.scheduledDate !== incoming.scheduledDate && (
    (localRecordingChanged && incoming.scheduledDate !== base.scheduledDate) ||
    (incomingRecordingChanged && local.scheduledDate !== base.scheduledDate)
  )) conflicts.push('scheduledDate', 'recordedOn');

  // Reviewed or edited timecodes must never move to a source selected by the
  // other branch. Ordinary media uploads can still merge with plan/DZ edits.
  const baseSource = videoSource(base), localSource = videoSource(local), incomingSource = videoSource(incoming);
  const localTimecodesChanged = timecodeFields.some(key => !same(local[key], base[key]));
  const incomingTimecodesChanged = timecodeFields.some(key => !same(incoming[key], base[key]));
  if (localSource !== incomingSource && (
    (incomingSource !== baseSource && localTimecodesChanged) ||
    (localSource !== baseSource && incomingTimecodesChanged)
  )) {
    for (const branch of [local, incoming]) {
      if (videoSource(branch) !== baseSource) conflicts.push(branch.videoId !== base.videoId ? 'videoId' : 'links');
    }
    conflicts.push(...timecodeFields.filter(key => !same(local[key], base[key]) || !same(incoming[key], base[key])));
  }

  return { merged: conflicts.length ? null : merged, conflicts: [...new Set(conflicts)] };
}
