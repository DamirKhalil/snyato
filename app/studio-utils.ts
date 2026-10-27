import type { AssetKind, Course, Lesson, Stage, StudioAsset } from './studio-model';

const DAY = 86_400_000;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const stamp = () => new Date().toISOString();
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const uid = newId;
const dateValue = (date: string) => Date.parse(`${date}T12:00:00Z`);

function isDate(date: string): boolean {
  return isoDate.test(date) && Number.isFinite(dateValue(date)) && new Date(dateValue(date)).toISOString().slice(0, 10) === date;
}

/** Calendar date in the course's timezone; date arithmetic itself uses UTC noon. */
export function today(timezone = 'Europe/Moscow'): string {
  return calendarDate(new Date(), timezone)!;
}

function calendarDate(value: string | Date, timezone: string): string | null {
  if (typeof value === 'string') {
    if (isoDate.test(value)) return isDate(value) ? value : null;
    // Stored instants need an explicit timezone; a timezone-less timestamp must not be guessed.
    if (!isDate(value.slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/iu.test(value)) return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}

export function addDays(date: string, days: number): string {
  if (!isDate(date) || !Number.isFinite(days)) throw new Error('Укажите корректную дату.');
  return new Date(dateValue(date) + Math.trunc(days) * DAY).toISOString().slice(0, 10);
}

export function formatDate(date: string | null | undefined, options: Intl.DateTimeFormatOptions = {}): string {
  if (!date || !isDate(date.slice(0, 10))) return 'Не назначена';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', ...options, timeZone: 'UTC' }).format(new Date(dateValue(date.slice(0, 10))));
}

export function prepDate(value: Lesson | string | null | undefined): string | null {
  const date = typeof value === 'object' && value !== null ? value.scheduledDate : value;
  return date && isDate(date) ? addDays(date, -2) : null;
}

function monday(date: string): string {
  const weekday = new Date(dateValue(date)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function daysBetween(start: string, end: string): number {
  return Math.round((dateValue(end) - dateValue(start)) / DAY);
}

export function createLesson(moduleId: string, order: number, title = '', code?: string): Lesson {
  return {
    id: uid(), code: code || `L${String(order + 1).padStart(2, '0')}`, title: title.trim() || `Урок ${order + 1}`,
    moduleId, order, outline: '', outlineReady: false, slidesRequired: false, slidesReady: false,
    homework: [], links: [], recordedOn: null, scheduledDate: null, baselineDate: null, durationMinutes: 0,
    deliveryDeadline: null, submittedAt: null,
    stage: 'assembling', assignee: '', takenAt: null, publishedAt: null, videoId: null,
    timecodes: '', timecodesStatus: 'draft', timecodesVideoId: null, changesPending: false, updatedAt: stamp(),
  };
}

export function createCourse(title: string, count = 25, moduleCount = 6, outlineText = ''): Course {
  count = Math.max(1, Math.min(1000, Math.trunc(count) || 25));
  moduleCount = Math.max(1, Math.min(50, Math.trunc(moduleCount) || 6));
  const createdAt = stamp();
  const course: Course = {
    id: uid(), title: title.trim() || 'Новый курс', subtitle: '', timezone: 'Europe/Moscow', isDemo: false, createdAt,
    modules: [], lessons: [], assets: [], baselineLockedAt: null, initialPlannedCount: count, history: [],
  };
  const lines = outlineText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const hasModules = lines.some(line => /^(?:#{1,3}\s*)?модуль(?:\s|\d|[:.])/iu.test(line));
  if (hasModules) {
    let currentModule = '';
    for (const line of lines) {
      if (/^(?:#{1,3}\s*)?модуль(?:\s|\d|[:.])/iu.test(line)) {
        const moduleTitle = line.replace(/^#{1,3}\s*/u, '').trim();
        const module = { id: uid(), title: moduleTitle };
        course.modules.push(module);
        currentModule = module.id;
      } else {
        if (!currentModule) {
          const module = { id: uid(), title: 'Модуль 1' };
          course.modules.push(module); currentModule = module.id;
        }
        const lessonTitle = cleanOutlineLine(line);
        if (lessonTitle) course.lessons.push(createLesson(currentModule, course.lessons.length, lessonTitle));
      }
    }
  } else {
    const titles = lines.map(cleanOutlineLine).filter(Boolean);
    const total = titles.length || count;
    const numberOfModules = Math.min(moduleCount, total);
    course.modules = Array.from({ length: numberOfModules }, (_, index) => ({ id: uid(), title: `Модуль ${index + 1}` }));
    course.lessons = Array.from({ length: total }, (_, index) => createLesson(course.modules[Math.min(numberOfModules - 1, Math.floor(index * numberOfModules / total))].id, index, titles[index] || ''));
  }
  if (!course.lessons.length) course.lessons.push(createLesson(course.modules[0]?.id || '', 0));
  course.initialPlannedCount = course.lessons.length;
  return course;
}

function cleanOutlineLine(line: string): string {
  return line.replace(/^[-*•]\s*/u, '').replace(/^(?:(?:урок|lesson)\s*)?\d+[.)\s:—-]+/iu, '').trim();
}

/** Explicit sample data, never represented as imported user content. */
export function createDemoCourse(): Course {
  const moduleNames = ['Точка старта', 'Разговор с ИИ', 'Личные ассистенты', 'Работа с контентом', 'Свои инструменты', 'Финальная сборка'];
  const titles = [
    'Настраиваем рабочее пространство', 'Выбираем задачи для ИИ', 'Собираем личную библиотеку', 'Формулируем запрос',
    'Уточняем контекст и ограничения', 'Проверяем ответ', 'Создаём личного ассистента', 'Пишем инструкцию ассистенту',
    'Тестируем на реальных задачах', 'Улучшаем результат', 'Работаем с документами', 'Создаём структуру материала',
    'Редактируем текст', 'Готовим презентацию', 'Собираем визуальный материал', 'Проектируем свой инструмент',
    'Определяем сценарии работы', 'Создаём первый прототип', 'Добавляем данные', 'Проверяем удобство',
    'Готовим инструмент к работе', 'Разбираем сложные случаи', 'Собираем итоговый проект', 'Проводим проверку', 'Выстраиваем личную систему',
  ];
  const course = createCourse('AI-практик', 25, 6, titles.join('\n'));
  course.isDemo = true;
  course.subtitle = 'Демонстрационный курс · можно редактировать';
  course.modules.forEach((module, index) => { module.title = moduleNames[index]; });
  const now = today(course.timezone), weekStart = monday(now);
  course.createdAt = `${addDays(weekStart, -28)}T09:00:00.000Z`;
  course.baselineLockedAt = course.createdAt;
  const recordedDates: string[] = [];
  [2, 3, 2, 4].forEach((number, week) => {
    for (let index = 0; index < number; index++) recordedDates.push(addDays(weekStart, -28 + week * 7 + index));
  });
  const elapsed = daysBetween(weekStart, now);
  for (let index = 0; index < 3; index++) recordedDates.push(addDays(weekStart, Math.min(index, elapsed)));
  course.lessons.forEach((lesson, index) => {
    lesson.slidesRequired = index % 2 === 0;
    lesson.outline = `Результат урока: ${lesson.title.toLowerCase()}.\n\n1. Объяснение подхода\n2. Разбор примера\n3. Самостоятельная практика`;
    lesson.outlineReady = index < 16;
    lesson.slidesReady = index < 14 && lesson.slidesRequired;
    if (index < 16) lesson.homework = ['Применить подход к своей рабочей задаче. Сохранить результат и коротко описать, что получилось.'];
    if (index < 14) {
      lesson.recordedOn = recordedDates[index];
      lesson.durationMinutes = 35 + (index % 5) * 6;
      lesson.baselineDate = addDays(recordedDates[index], -(index % 3));
      lesson.scheduledDate = recordedDates[index];
      lesson.timecodes = '00:00 Что получится на занятии\n03:40 Разбираем подход\n12:10 Работаем на примере\n28:30 Домашнее задание';
      lesson.timecodesStatus = index < 11 ? 'checked' : 'draft';
      lesson.stage = index < 6 ? 'published' : index < 9 ? 'taken' : index < 11 ? 'ready' : 'assembling';
      if (index < 11) {
        lesson.deliveryDeadline = addDays(recordedDates[index], index === 8 ? -1 : 1);
        lesson.submittedAt = `${recordedDates[index]}T10:00:00.000Z`;
      } else lesson.deliveryDeadline = addDays(now, index - 12);
      if (index < 9) { lesson.assignee = 'Редактор'; lesson.takenAt = `${recordedDates[index]}T12:00:00.000Z`; }
      if (index < 6) lesson.publishedAt = `${recordedDates[index]}T16:00:00.000Z`;
    } else {
      lesson.baselineDate = addDays(now, (index - 14) * 2);
      lesson.scheduledDate = addDays(lesson.baselineDate, 2);
      lesson.deliveryDeadline = addDays(lesson.scheduledDate, 1);
    }
  });
  course.history.push({ id: uid(), at: stamp(), text: 'Открыт демонстрационный курс. Все примеры условные.' });
  return course;
}

export function lockBaseline(course: Course): Course {
  if (course.baselineLockedAt) return structuredClone(course);
  const copy = structuredClone(course);
  copy.baselineLockedAt = stamp(); copy.initialPlannedCount = copy.lessons.length;
  copy.lessons.forEach(lesson => { lesson.baselineDate = lesson.scheduledDate; });
  return addHistory(copy, 'Утверждён первоначальный график записи');
}

export function addHistory(course: Course, text: string): Course {
  course.history = [{ id: uid(), at: stamp(), text }, ...course.history].slice(0, 100);
  return course;
}

export function classifyFile(name: string): { code: string | null; kind: AssetKind } {
  const normalized = name.normalize('NFKC');
  const match = normalized.match(/(?:^|[^\p{L}\p{N}])(?:lesson|lsn|урок|l|л)\s*[-_ ]?\s*(\d{1,4})(?=$|[^\p{L}\p{N}])/iu);
  const code = match ? `L${String(Number(match[1])).padStart(2, '0')}` : null;
  const extension = normalized.split('.').pop()?.toLowerCase() || '';
  let kind: AssetKind = 'file';
  if (/(?:исходник|source|master|\.screenflow\b|проект)/iu.test(normalized)) kind = 'source';
  else if (/(?:план(?:[._\s-]|$)|outline|сценарий)/iu.test(normalized)) kind = 'outline';
  else if (/^(?:pptx?|key)$/iu.test(extension) || /(?:презентаци|slides?)/iu.test(normalized)) kind = 'slides';
  else if (/^(?:mp4|mov|mkv|avi|m4v|webm)$/iu.test(extension)) kind = 'video';
  return { code, kind };
}

/** Keep an existing assignment until the filename changes; newly recognized inbox files can still route. */
export function resolveFileLessonId(name: string, code: string | null, lessons: Pick<Lesson, 'id' | 'code'>[], existing?: Pick<StudioAsset, 'name' | 'lessonId'>): string | null {
  const retained = existing?.name === name && lessons.some(lesson => lesson.id === existing.lessonId) ? existing.lessonId : null;
  return retained || lessons.find(lesson => lesson.code.toUpperCase() === code?.toUpperCase())?.id || null;
}

export type DeliveryStatus = {
  kind: 'none' | 'upcoming' | 'soon' | 'today' | 'overdue' | 'on_time' | 'late' | 'submitted_unknown';
  label: string;
  /** Deadline minus comparison date in calendar days: positive means early/time remaining. */
  days: number | null;
};

function dayPhrase(value: number): string {
  const amount = Math.abs(value), lastTwo = amount % 100, last = amount % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14 ? 'дней' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дня' : 'дней';
  return `${amount} ${noun}`;
}

/** Deadline concerns the complete handoff, independently of recording and preparation dates. */
export function getDeliveryStatus(lesson: Lesson, timezone = 'Europe/Moscow', asOf?: string | Date): DeliveryStatus {
  const deadline = lesson.deliveryDeadline;
  if (!deadline || !isDate(deadline)) return { kind: 'none', label: 'Срок сдачи не назначен', days: null };
  if (lesson.submittedAt) {
    const submittedDate = calendarDate(lesson.submittedAt, timezone);
    if (!submittedDate) return { kind: 'submitted_unknown', label: 'Дата передачи не зафиксирована', days: null };
    const days = daysBetween(submittedDate, deadline);
    return days < 0
      ? { kind: 'late', label: `Передано на ${dayPhrase(days)} позже`, days }
      : { kind: 'on_time', label: 'Передано вовремя', days };
  }
  // Existing ready/taken/published records predate submittedAt: never fabricate a handoff date.
  if (lesson.stage !== 'assembling') return { kind: 'submitted_unknown', label: 'Дата передачи не зафиксирована', days: null };
  const currentDate = asOf === undefined ? today(timezone) : calendarDate(asOf, timezone);
  if (!currentDate) throw new Error('Укажите корректную дату сравнения срока сдачи.');
  const days = daysBetween(currentDate, deadline);
  if (days < 0) return { kind: 'overdue', label: `Просрочено на ${dayPhrase(days)}`, days };
  if (days === 0) return { kind: 'today', label: 'Сдать сегодня', days };
  if (days <= 2) return { kind: 'soon', label: `Сдача через ${dayPhrase(days)}`, days };
  return { kind: 'upcoming', label: `Сдача через ${dayPhrase(days)}`, days };
}

/** Scheduling conflicts inform planning; they never block a late but valid handoff. */
export function deliveryConflicts(course: Course): Lesson[] {
  return course.lessons.filter(lesson => !lesson.recordedOn && !lesson.submittedAt && lesson.stage === 'assembling' && !!lesson.scheduledDate && isDate(lesson.scheduledDate)
    && !!lesson.deliveryDeadline && isDate(lesson.deliveryDeadline) && lesson.scheduledDate > lesson.deliveryDeadline);
}

export type CourseMetrics = {
  count: number; recorded: number; remaining: number; minutes: number; percent: number;
  thisWeek: number; pace: number; paceLabel: string; pacePeriodDays: number;
  stageCounts: Record<Stage, number>; allStageCounts: Record<Stage, number>;
  overdueRecords: Lesson[]; prepDue: Lesson[]; nextLesson: Lesson | null;
  overdueDelivery: Lesson[]; upcomingDelivery: Lesson[]; nextDelivery: Lesson | null; deliveryConflicts: Lesson[];
  currentFinish: string | null; baselineFinish: string | null; finishShiftDays: number | null;
  addedCount: number; remainingWeeks: number | null;
};

export function getMetrics(course: Course): CourseMetrics {
  const now = today(course.timezone), weekStart = monday(now);
  const recordedLessons = course.lessons.filter(lesson => !!lesson.recordedOn && lesson.recordedOn <= now);
  const stageCounts: Record<Stage, number> = { assembling: 0, ready: 0, taken: 0, published: 0 };
  const allStageCounts: Record<Stage, number> = { assembling: 0, ready: 0, taken: 0, published: 0 };
  recordedLessons.forEach(lesson => { stageCounts[lesson.stage]++; });
  course.lessons.forEach(lesson => { allStageCounts[lesson.stage]++; });
  const earliestRecord = recordedLessons.map(lesson => lesson.recordedOn!).sort()[0];
  const courseStart = course.createdAt.slice(0, 10);
  const historyStart = earliestRecord || courseStart;
  const fourWeeksAgo = addDays(weekStart, -28);
  let periodStart = historyStart > fourWeeksAgo ? historyStart : fourWeeksAgo;
  let periodEnd = weekStart;
  let periodDays = Math.max(0, daysBetween(periodStart, periodEnd));
  let paceLabel = periodDays === 28 ? 'за 4 полные недели' : `за ${periodDays} дн. до этой недели`;
  if (periodDays === 0 || periodStart >= weekStart) {
    periodStart = historyStart > now ? now : historyStart;
    periodEnd = addDays(now, 1);
    periodDays = Math.max(1, daysBetween(periodStart, periodEnd));
    paceLabel = `за ${periodDays} дн. с начала записи`;
  }
  const paceCount = recordedLessons.filter(lesson => lesson.recordedOn! >= periodStart && lesson.recordedOn! < periodEnd).length;
  const pace = paceCount / (periodDays / 7);
  const currentDates = course.lessons.map(lesson => lesson.scheduledDate).filter((date): date is string => !!date).sort();
  const baselineDates = course.lessons.map(lesson => lesson.baselineDate).filter((date): date is string => !!date).sort();
  const currentFinish = currentDates.at(-1) || null, baselineFinish = baselineDates.at(-1) || null;
  const pending = course.lessons.filter(lesson => !lesson.recordedOn);
  const upcoming = pending.filter(lesson => !!lesson.scheduledDate && lesson.scheduledDate >= now).sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!) || a.order - b.order);
  const overdueRecords = pending.filter(lesson => !!lesson.scheduledDate && lesson.scheduledDate < now).sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!));
  const prepDue = pending.filter(lesson => {
    const date = prepDate(lesson);
    return !!date && date <= now && (!lesson.outlineReady || (lesson.slidesRequired && !lesson.slidesReady));
  }).sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!));
  const remaining = course.lessons.length - recordedLessons.length;
  const deliveryStatuses = course.lessons.map(lesson => ({ lesson, status: getDeliveryStatus(lesson, course.timezone, now) }));
  const byDelivery = (a: Lesson, b: Lesson) => a.deliveryDeadline!.localeCompare(b.deliveryDeadline!) || a.order - b.order;
  const overdueDelivery = deliveryStatuses.filter(item => item.status.kind === 'overdue').map(item => item.lesson).sort(byDelivery);
  const upcomingDelivery = deliveryStatuses.filter(item => ['upcoming', 'soon', 'today'].includes(item.status.kind)).map(item => item.lesson).sort(byDelivery);
  return {
    count: course.lessons.length, recorded: recordedLessons.length, remaining,
    minutes: recordedLessons.reduce((sum, lesson) => sum + Math.max(0, lesson.durationMinutes), 0),
    percent: course.lessons.length ? Math.round(recordedLessons.length / course.lessons.length * 100) : 0,
    thisWeek: recordedLessons.filter(lesson => lesson.recordedOn! >= weekStart).length,
    pace, paceLabel, pacePeriodDays: periodDays, stageCounts, allStageCounts, overdueRecords, prepDue,
    overdueDelivery, upcomingDelivery, nextDelivery: upcomingDelivery[0] || overdueDelivery[0] || null,
    deliveryConflicts: deliveryConflicts(course),
    nextLesson: upcoming[0] || overdueRecords[0] || null, currentFinish, baselineFinish,
    finishShiftDays: currentFinish && baselineFinish ? daysBetween(baselineFinish, currentFinish) : null,
    addedCount: course.baselineLockedAt ? Math.max(0, course.lessons.length - course.initialPlannedCount) : 0,
    remainingWeeks: pace > 0 && recordedLessons.length >= 3 && periodDays >= 7 ? remaining / pace : null,
  };
}

function validURL(value: string): boolean {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}

export function checkLessonReadiness(course: Course, lesson: Lesson, options: { requireTimecodes?: boolean } = {}): string[] {
  const missing: string[] = [];
  if (!lesson.title.trim() || /^урок\s+\d+$/iu.test(lesson.title.trim())) missing.push('Уточнить название урока');
  const assets = course.assets.filter(asset => asset.lessonId === lesson.id);
  const video = assets.find(asset => asset.id === lesson.videoId && asset.kind === 'video');
  const videoLink = lesson.links.some(link => /(?:видео|запись)/iu.test(link.name) && validURL(link.url));
  if (!video && !videoLink) missing.push('Добавить финальное видео или ссылку с подписью «Видео»');
  if (!lesson.homework.some(task => task.trim())) missing.push('Добавить домашнее задание');
  if (lesson.slidesRequired) {
    const hasSlides = assets.some(asset => asset.kind === 'slides') || lesson.links.some(link => /(?:презентаци|slides)/iu.test(link.name) && validURL(link.url));
    if (!hasSlides) missing.push('Добавить презентацию');
    if (!lesson.slidesReady) missing.push('Отметить презентацию готовой');
  }
  if (options.requireTimecodes && !lesson.timecodes.trim()) missing.push('Добавить оглавление с тайм-кодами');
  if (lesson.timecodes.trim() && lesson.timecodesVideoId && lesson.videoId && lesson.timecodesVideoId !== lesson.videoId) missing.push('Проверить тайм-коды после замены видео');
  return missing;
}

const ordinalRules: [RegExp, number][] = [
  [/\bfirst\b/iu, 1], [/перв(?:ый|ому|ого|ом|ая|ой)(?=$|[^\p{L}])/iu, 1], [/втор(?:ой|ому|ого|ом|ая)(?=$|[^\p{L}])/iu, 2],
  [/трет(?:ий|ьему|ьего|ьем|ья|ьей)(?=$|[^\p{L}])/iu, 3], [/четв[её]рт(?:ый|ому|ого|ом|ая|ой)(?=$|[^\p{L}])/iu, 4],
  [/пят(?:ый|ому|ого|ом|ая|ой)(?=$|[^\p{L}])/iu, 5], [/шест(?:ой|ому|ого|ом|ая)(?=$|[^\p{L}])/iu, 6],
  [/седьм(?:ой|ому|ого|ом|ая)(?=$|[^\p{L}])/iu, 7], [/восьм(?:ой|ому|ого|ом|ая)(?=$|[^\p{L}])/iu, 8],
  [/девят(?:ый|ому|ого|ом|ая|ой)(?=$|[^\p{L}])/iu, 9], [/десят(?:ый|ому|ого|ом|ая|ой)(?=$|[^\p{L}])/iu, 10],
];

function locateLesson(course: Course, text: string): Lesson {
  const code = text.match(/(?:^|[^\p{L}\p{N}])(?:l|lesson)\s*[-_ ]?(\d{1,4})(?=$|[^\p{L}\p{N}])/iu);
  if (code) {
    const found = course.lessons.find(lesson => Number(lesson.code.replace(/\D/g, '')) === Number(code[1]));
    if (found) return found;
    throw new Error(`Урок с кодом L${String(Number(code[1])).padStart(2, '0')} не найден.`);
  }
  const numberMatch = text.match(/урок(?:у|а|е|ом)?\s*(?:№\s*)?(\d{1,4})/iu) || text.match(/(?:к\s+)?(\d{1,4})(?:[ -]?(?:му|го|й|ому))?\s+урок/iu);
  let number = numberMatch ? Number(numberMatch[1]) : null;
  if (!number) {
    const prefix = text.split(/урок/iu)[0];
    number = ordinalRules.find(([pattern]) => pattern.test(prefix))?.[1] || null;
  }
  if (number) {
    const found = [...course.lessons].sort((a, b) => a.order - b.order)[number - 1];
    if (found) return found;
    throw new Error(`В программе нет урока под номером ${number}.`);
  }
  const foundByName = course.lessons.filter(lesson => lesson.title && text.toLocaleLowerCase('ru').includes(lesson.title.toLocaleLowerCase('ru')));
  if (foundByName.length === 1) return foundByName[0];
  throw new Error('Укажите урок: например, «К L07 добавь ДЗ: …».');
}

function parseDate(text: string, timezone: string): string | null {
  const now = today(timezone);
  if (/послезавтра/iu.test(text)) return addDays(now, 2);
  if (/завтра/iu.test(text)) return addDays(now, 1);
  if (/вчера/iu.test(text)) return addDays(now, -1);
  if (/сегодня/iu.test(text)) return now;
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/u);
  if (iso) { if (!isDate(iso[1])) throw new Error('Некорректная дата. Используйте ГГГГ-ММ-ДД.'); return iso[1]; }
  const numeric = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?\b/u);
  if (numeric) {
    const year = numeric[3] ? (numeric[3].length === 2 ? '20' + numeric[3] : numeric[3]) : now.slice(0, 4);
    const date = `${year}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
    if (!isDate(date)) throw new Error('Такой даты нет в календаре.');
    return date;
  }
  const months = ['январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  for (let index = 0; index < months.length; index++) {
    const match = text.match(new RegExp(`(?:^|\\s)(\\d{1,2})\\s+${months[index]}[а-я]*(?:\\s+(\\d{4}))?`, 'iu'));
    if (match) {
      const date = `${match[2] || now.slice(0, 4)}-${String(index + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
      if (!isDate(date)) throw new Error('Такой даты нет в календаре.');
      return date;
    }
  }
  return null;
}

function cleanContent(text: string): string {
  return text.replace(/^[\s:—–-]+/u, '').replace(/^[«"“]|[»"”]$/gu, '').trim();
}

export type CommandResult = { course: Course; summary: string; lessonIds: string[] };

/** Deterministic supported commands. One command per line; throws before any external mutation. */
export function parseCommand(course: Course, text: string): CommandResult {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Напишите, что добавить или изменить.');
  if (lines.length > 30) throw new Error('За один раз можно выполнить до 30 команд.');
  const copy = structuredClone(course), summaries: string[] = [], lessonIds: string[] = [];
  for (const line of lines) {
    const newLesson = line.match(/^(?:добавь|добавить|создай|создать)\s+(?:новый\s+)?(?:урок|тему)\s*[:«"—-]\s*(.+)$/iu);
    if (newLesson) {
      const title = cleanContent(newLesson[1]);
      if (!title) throw new Error('Укажите тему нового урока.');
      const nextCode = Math.max(0, ...copy.lessons.map(lesson => Number(lesson.code.replace(/\D/g, '')) || 0)) + 1;
      const lesson = createLesson(copy.modules.at(-1)?.id || '', copy.lessons.length, title, `L${String(nextCode).padStart(2, '0')}`);
      copy.lessons.push(lesson); lessonIds.push(lesson.id); summaries.push(`${lesson.code}: добавлен урок «${lesson.title}»`); continue;
    }
    const lesson = locateLesson(copy, line);
    let action = '';
    const homework = line.match(/(?:домашн(?:ее|его|ему|им|ем)?\s+задани(?:е|я|ю|ем)|дз)(?=$|[^\p{L}])/iu);
    if (/презентаци[а-я]*\s+(?:не\s+(?:нужна|требуется|будет)|нет)|без\s+презентаци/iu.test(line)) {
      lesson.slidesRequired = false; lesson.slidesReady = false; action = 'презентация не требуется';
    } else if (homework && /(?:добав|замен|дополн|задани|дз)/iu.test(line)) {
      let value = cleanContent(line.slice(homework.index! + homework[0].length));
      value = value.replace(/^(?:к\s+)?(?:урок(?:у)?\s*)?(?:l|lesson)?\s*\d+\s*[:—-]\s*/iu, '').trim();
      if (!value) throw new Error('После «ДЗ:» укажите текст задания.');
      if (/замен/iu.test(line)) { lesson.homework = [value]; action = 'домашнее задание заменено'; }
      else if (/дополн/iu.test(line)) {
        const index = /втор/iu.test(line) ? 1 : 0;
        if (!lesson.homework[index]) throw new Error('Такого задания пока нет. Используйте «Добавь ДЗ: …».');
        lesson.homework[index] = `${lesson.homework[index]}\n${value}`; action = 'домашнее задание дополнено';
      } else { lesson.homework.push(value); action = 'добавлено домашнее задание'; }
    } else if (/(?:дедлайн|срок\s+(?:сдачи|передачи)|(?:сдач[аи]|передач[аи])\s+(?:урока|комплекта))/iu.test(line)) {
      if (/(?:убери|удали|сними|отмени|очисти|без\s+дедлайн)/iu.test(line)) {
        lesson.deliveryDeadline = null;
        action = 'срок сдачи комплекта снят';
      } else {
        const date = parseDate(line, copy.timezone);
        if (!date) throw new Error('Укажите срок сдачи: например, «К L07 дедлайн 20 ноября» или «Срок сдачи L07 2026-11-20».');
        const previous = lesson.deliveryDeadline;
        lesson.deliveryDeadline = date;
        action = previous ? `срок сдачи комплекта изменён с ${formatDate(previous)} на ${formatDate(date)}` : `срок сдачи комплекта назначен на ${formatDate(date)}`;
      }
    } else if (/(?:переимен|назови|название)/iu.test(line)) {
      const match = line.match(/(?:переименуй|переименовать|назови|назвать)(?:\s+(?:урок(?:\s+\d+)?|l\d+))?\s*(?:в\s+)?[:—-]?\s*[«"](.+?)[»"]\s*$/iu)
        || line.match(/(?:переименуй|переименовать|назови|назвать|название\s*(?:поменяй|замени)?|(?:поменяй|измени)\s+название)\s*(?:в\s+)?[:—-]?\s*(.+)$/iu);
      if (!match) throw new Error('Например: «К L07 поменяй название: Новая тема».');
      const title = cleanContent(match[1]).replace(/^(?:урок\s*\d+|l\d+)\s+(?:в\s+)?/iu, '').trim();
      if (!title) throw new Error('Укажите новое название.');
      lesson.title = title; action = `название изменено на «${title}»`;
    } else if (/(?:записал|записан|записано|снял|снято|завершил\s+запись)/iu.test(line)) {
      const actual = parseDate(line, copy.timezone) || today(copy.timezone);
      if (actual > today(copy.timezone)) throw new Error('Фактическая дата записи не может быть в будущем. Для будущей даты используйте «Запланируй».');
      lesson.recordedOn = actual; action = `записан ${formatDate(actual)}`;
    } else if (/(?:перенес|перенос|перенеси|запланир|назнач|запись|дата)/iu.test(line)) {
      const date = parseDate(line, copy.timezone);
      if (!date) throw new Error('Укажите дату записи: например, «Перенеси L07 на 2026-11-20».');
      if (lesson.recordedOn) throw new Error(`${lesson.code} уже записан. План на момент записи сохраняется; факт можно исправить отдельной командой.`);
      const oldDate = lesson.scheduledDate;
      lesson.scheduledDate = date;
      action = oldDate ? `запись перенесена с ${formatDate(oldDate)} на ${formatDate(date)}` : `запись назначена на ${formatDate(date)}`;
    } else if (/(?:готов|подготовлен)/iu.test(line) && /(?:план|презентаци)/iu.test(line)) {
      const ready = !/не\s+(?:готов|подготовлен)/iu.test(line);
      if (/план/iu.test(line)) lesson.outlineReady = ready;
      if (/презентаци/iu.test(line)) { lesson.slidesRequired = true; lesson.slidesReady = ready; }
      action = ready
        ? /план/iu.test(line) && /презентаци/iu.test(line) ? 'план и презентация отмечены готовыми' : /план/iu.test(line) ? 'план отмечен готовым' : 'презентация отмечена готовой'
        : 'готовность подготовки снята';
    } else if (/https?:\/\//iu.test(line)) {
      const matches = line.match(/https?:\/\/[^\s<>"»]+/giu) || [];
      let added = 0;
      for (const raw of matches) {
        const url = raw.replace(/[.,;)>]+$/u, '');
        if (!validURL(url)) throw new Error('Некорректная ссылка.');
        const named = line.match(/(?:подписью|названием|подпись)\s*:?\s*[«"]([^»"]+)[»"]/iu);
        const name = named?.[1] || new URL(url).hostname;
        if (!lesson.links.some(link => link.url === url)) { lesson.links.push({ name, url }); added++; }
      }
      action = added ? `добавлено ссылок: ${added}` : 'ссылка уже добавлена';
    } else if (/(?:план\s*(?:урока)?|сценарий)\s*[:—-]/iu.test(line)) {
      const match = line.match(/(?:план\s*(?:урока)?|сценарий)\s*[:—-]\s*(.+)$/iu);
      if (!match?.[1]) throw new Error('После «План:» добавьте тезисы урока.');
      lesson.outline = match[1].trim(); lesson.outlineReady = false; action = 'обновлён план урока';
    } else {
      throw new Error('Не удалось распознать действие. Примеры: «К L07 добавь ДЗ: …», «К L07 поменяй название: …», «Перенеси L07 на 2026-11-20», «К L07 дедлайн 20 ноября». Команды пишите по одной на строку.');
    }
    lesson.updatedAt = stamp();
    if (lesson.stage !== 'assembling') lesson.changesPending = true;
    if (!lessonIds.includes(lesson.id)) lessonIds.push(lesson.id);
    summaries.push(`${lesson.code} «${lesson.title}»: ${action}`);
  }
  const summary = summaries.join('\n');
  addHistory(copy, summary);
  return { course: copy, summary, lessonIds };
}
