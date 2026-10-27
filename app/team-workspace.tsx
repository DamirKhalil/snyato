'use client';

import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, CheckCheck, ChevronDown, Copy, FileText, Film, FolderOpen, Link2, Search } from 'lucide-react';
import type { Course, Lesson, Stage, StudioAsset, StudioUser } from './studio-model';
import { STAGE_LABELS } from './studio-model';
import { checkLessonReadiness, getHomeworkMaterials, getLessonVideo, lessonHasHomework } from './studio-utils';
import './team-workspace.css';

type Props = {
  course: Course;
  user: StudioUser;
  busy: boolean;
  onOpenLesson: (id: string) => void;
  onStage: (id: string, stage: 'ready' | 'taken' | 'published') => Promise<void>;
};
type Filter = 'all' | Stage;
type Feedback = { lessonId: string; message: string; error: boolean } | null;
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все материалы' }, { id: 'assembling', label: 'Готовятся' },
  { id: 'ready', label: 'Ожидают работы' }, { id: 'taken', label: 'В работе' }, { id: 'published', label: 'Размещены' },
];
const groups = [
  { kind: 'video', label: 'Записи урока' }, { kind: 'homework', label: 'Домашнее задание' },
  { kind: 'slides', label: 'Презентация' }, { kind: 'outline', label: 'План урока' },
  { kind: 'file', label: 'Приложения' }, { kind: 'source', label: 'Исходники' },
];
const stageOrder: Record<Stage, number> = { ready: 0, taken: 1, assembling: 2, published: 3 };
function safeUrl(value: string) {
  if (/^\/api\/assets\/[a-zA-Z0-9_-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function dateLabel(value?: string | null) {
  if (!value) return 'Не задан';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Не задан' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
function stampLabel(value: string, timezone: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Время не зафиксировано' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(date);
}
function sizeLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ГБ`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}
function fileCountLabel(count: number) {
  const ending = count % 100 >= 11 && count % 100 <= 14 ? 'файлов' : count % 10 === 1 ? 'файл' : count % 10 >= 2 && count % 10 <= 4 ? 'файла' : 'файлов';
  return `${count} ${ending}`;
}
function timecodesAreChecked(course: Course, lesson: Lesson) {
  const video = getLessonVideo(course, lesson);
  return lesson.timecodesStatus === 'checked' && (video.asset ? lesson.timecodesVideoId === video.asset.id : !!video.link && (!lesson.timecodesVideoId || lesson.timecodesVideoId.startsWith('link:')));
}
function textBundle(course: Course, lesson: Lesson) {
  const homework = getHomeworkMaterials(course, lesson);
  const assets = course.assets.filter(asset => asset.lessonId === lesson.id);
  const sections = [`${lesson.code} — ${lesson.title}`, course.title];
  if (lesson.deliveryDeadline) sections.push(`Сдать комплект до: ${dateLabel(lesson.deliveryDeadline)}`);
  if (lesson.outline.trim()) sections.push(`ПЛАН УРОКА\n\n${lesson.outline.trim()}`);
  if (homework.text.length) sections.push(`ДОМАШНЕЕ ЗАДАНИЕ\n\n${homework.text.map((text, index) => `${index + 1}. ${text}`).join('\n\n')}`);
  if (lesson.timecodes.trim()) sections.push(`ТАЙМ-КОДЫ · ${timecodesAreChecked(course, lesson) ? 'проверены' : 'черновик'}\n\n${lesson.timecodes.trim()}`);
  if (lesson.links.length) sections.push(`ССЫЛКИ\n\n${lesson.links.filter(link => safeUrl(link.url)).map(link => `${link.name}\n${link.url}`).join('\n\n')}`);
  if (assets.length) sections.push(`ФАЙЛЫ УРОКА\n\n${assets.map(asset => `${asset.name}${asset.id === lesson.videoId ? ' — актуальная запись' : ''}${asset.source === 'dropbox' && !asset.directLink ? '\nФайл в общей папке Dropbox' : ''}`).join('\n\n')}`);
  return sections.join('\n\n────────────────────\n\n') + '\n';
}

export default function TeamWorkspace({ course, user, busy, onOpenLesson, onStage }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const pendingRef = useRef(false);
  const available = course.lessons.filter(lesson => lesson.stage !== 'assembling' || course.assets.some(asset => asset.lessonId === lesson.id) || lesson.outline.trim() || lesson.homework.some(item => item.trim()) || lesson.links.length || lesson.timecodes.trim());
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
  const queue = available.filter(lesson => (filter === 'all' || lesson.stage === filter) && (!needle || `${lesson.code} ${lesson.title}`.normalize('NFKC').toLocaleLowerCase('ru-RU').includes(needle)))
    .sort((left, right) => stageOrder[left.stage] - stageOrder[right.stage] || (left.deliveryDeadline || '9999').localeCompare(right.deliveryDeadline || '9999') || left.order - right.order);
  const locked = busy || pendingId !== null;

  async function changeStage(lesson: Lesson, stage: 'ready' | 'taken' | 'published') {
    if (busy || pendingRef.current) return;
    pendingRef.current = true;
    setPendingId(lesson.id);
    setFeedback(null);
    try {
      await onStage(lesson.id, stage);
      setFeedback({ lessonId: lesson.id, error: false, message: stage === 'taken' ? 'Урок взят в работу. Исполнитель и время сохранены.' : stage === 'published' ? 'Размещение урока отмечено.' : 'Комплект передан в очередь команды.' });
    } catch (error) {
      setFeedback({ lessonId: lesson.id, error: true, message: error instanceof Error ? error.message : 'Не удалось изменить статус. Повтори действие.' });
    } finally {
      pendingRef.current = false;
      setPendingId(null);
    }
  }
  async function copyTexts(lesson: Lesson) {
    try {
      await navigator.clipboard.writeText(textBundle(course, lesson));
      setFeedback({ lessonId: lesson.id, error: false, message: 'Тексты и список материалов скопированы.' });
    } catch {
      setFeedback({ lessonId: lesson.id, error: true, message: 'Не удалось скопировать. Скачай тексты в .txt или выдели нужный текст ниже.' });
    }
  }
  function downloadTexts(lesson: Lesson) {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + textBundle(course, lesson)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${lesson.code}_материалы.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function assetRow(asset: StudioAsset, lesson: Lesson) {
    const href = safeUrl(asset.url);
    const folderOnly = asset.source === 'dropbox' && !asset.directLink;
    const action = folderOnly ? 'Открыть папку' : asset.source === 'dropbox' ? 'Открыть файл' : 'Скачать';
    return <div className="team-workspace-file" key={asset.id}>
      <span className="team-workspace-file-icon">{asset.kind === 'video' ? <Film size={19} /> : <FileText size={19} />}</span>
      <div className="team-workspace-file-name"><strong>{asset.name}</strong><small>{sizeLabel(asset.size)}{asset.source === 'dropbox' ? ' · Dropbox' : ' · В студии'}{asset.id === lesson.videoId ? ' · Актуальная запись' : asset.kind === 'video' ? ' · Другая версия записи' : ''}</small>{folderOnly && <small>Найди этот файл по имени в общей папке.</small>}</div>
      {href ? <a className="team-workspace-file-action" href={href} download={asset.source !== 'dropbox' ? asset.name : undefined} target={asset.source === 'dropbox' ? '_blank' : undefined} rel="noopener noreferrer" aria-label={`${action}: ${asset.name}`}>{folderOnly ? <FolderOpen size={16} /> : asset.source === 'dropbox' ? <ArrowUpRight size={16} /> : <ArrowDownToLine size={16} />}{action}</a> : <span className="team-workspace-muted">Ссылка недоступна</span>}
    </div>;
  }

  return <section className="team-workspace" aria-labelledby="team-workspace-title">
    <header className="team-workspace-heading"><div><p className="team-workspace-eyebrow">Материалы и размещение</p><h2 id="team-workspace-title">Рабочее место техспециалиста</h2><p>Забирай материалы по урокам. Полный комплект для передачи — видео и домашнее задание.</p></div><span className="team-workspace-course">{course.title}</span></header>
    <div className="team-workspace-tools"><div className="team-workspace-filters" aria-label="Фильтр очереди">{filters.map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{item.id === 'all' ? available.length : available.filter(lesson => lesson.stage === item.id).length}</span></button>)}</div><label className="team-workspace-search"><Search size={17} /><input type="search" aria-label="Найти урок в очереди команды" placeholder="Код или название урока" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    {feedback && !queue.some(lesson => lesson.id === feedback.lessonId) && <p className={`team-workspace-feedback ${feedback.error ? 'is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
    {!queue.length && <div className="team-workspace-empty"><FolderOpen size={26} /><h3>{available.length ? 'Подходящих уроков нет' : 'Здесь появятся материалы уроков'}</h3><p>{available.length ? 'Измени фильтр или поисковый запрос.' : 'Файлы, планы и задания доступны здесь по мере подготовки. После передачи комплекта можно отметить начало работы.'}</p>{available.length > 0 && <button type="button" className="team-workspace-link" onClick={() => { setFilter('all'); setQuery(''); }}>Показать все материалы</button>}</div>}
    <div className="team-workspace-queue">{queue.map(lesson => {
      const assets = course.assets.filter(asset => asset.lessonId === lesson.id);
      const homework = getHomeworkMaterials(course, lesson);
      const video = getLessonVideo(course, lesson);
      const missing = checkLessonReadiness(course, lesson);
      const publicationMissing = checkLessonReadiness(course, lesson, { forPublication: true });
      const expanded = expandedId === lesson.id;
      const inWork = lesson.stage === 'taken' || lesson.stage === 'published';
      const hasTexts = !!lesson.outline.trim() || homework.text.length > 0 || !!lesson.timecodes.trim() || lesson.links.length > 0;
      const timecodesChecked = timecodesAreChecked(course, lesson);
      return <article className="team-workspace-lesson" key={lesson.id}>
        <header className="team-workspace-lesson-heading"><button type="button" className="team-workspace-disclosure" aria-expanded={expanded} aria-controls={`team-materials-${lesson.id}`} onClick={() => setExpandedId(expanded ? null : lesson.id)}><span className="team-workspace-code">{lesson.code}</span><span><strong>{lesson.title}</strong><small>{course.modules.find(module => module.id === lesson.moduleId)?.title || 'Без модуля'} · {fileCountLabel(assets.length)}</small><span className="team-workspace-open-label">{expanded ? 'Скрыть материалы' : 'Показать материалы'}<ChevronDown size={15} /></span></span></button><div className="team-workspace-lesson-state"><span className={`team-workspace-status is-${lesson.stage}`}>{STAGE_LABELS[lesson.stage]}</span>{lesson.deliveryDeadline && <small>Сдать до {dateLabel(lesson.deliveryDeadline)}</small>}</div></header>
        <div className="team-workspace-workline"><label className={`team-workspace-checkbox ${inWork ? 'is-checked' : ''}`}><input type="checkbox" checked={inWork} disabled={lesson.stage !== 'ready' || locked || missing.length > 0} onChange={event => { if (event.target.checked) void changeStage(lesson, 'taken'); }} /><span>Ушло в работу · {lesson.code}{pendingId === lesson.id && <small>Сохраняем изменение…</small>}{inWork && <small>{lesson.assignee || 'Исполнитель не указан'}{lesson.takenAt ? ` · ${stampLabel(lesson.takenAt, course.timezone)}` : ' · время не зафиксировано'}</small>}</span></label><div className="team-workspace-actions">{user.role === 'owner' && lesson.stage === 'assembling' && <button type="button" className="team-workspace-primary" disabled={locked || missing.length > 0} onClick={() => void changeStage(lesson, 'ready')}>Передать комплект<ArrowUpRight size={16} /></button>}{lesson.stage === 'taken' && <button type="button" className="team-workspace-primary" disabled={locked || publicationMissing.length > 0} onClick={() => void changeStage(lesson, 'published')}>Размещено<CheckCheck size={17} /></button>}<button type="button" className="team-workspace-link" onClick={() => onOpenLesson(lesson.id)}>Карточка урока<ArrowUpRight size={15} /></button></div></div>
        {lesson.stage === 'assembling' && <p className="team-workspace-stage-help">{missing.length ? `Комплект ещё готовится: ${missing.join('; ')}.` : 'Видео и домашнее задание доступны. Автор может передать комплект.'} Материалы можно открывать заранее; начало работы отмечается после передачи.</p>}
        {lesson.stage === 'ready' && missing.length > 0 && <p className="team-workspace-stage-help">В переданном комплекте не хватает материалов: {missing.join('; ')}. Проверь карточку урока.</p>}
        {lesson.stage === 'taken' && publicationMissing.length > 0 && <p className="team-workspace-stage-help">До размещения: {publicationMissing.join('; ')}.</p>}
        {lesson.stage === 'published' && lesson.publishedAt && <p className="team-workspace-stage-help team-workspace-done"><Check size={14} />Размещено {stampLabel(lesson.publishedAt, course.timezone)}</p>}
        {lesson.changesPending && <p className="team-workspace-change-note">После передачи комплект изменился. Проверь актуальные материалы в карточке урока.</p>}
        {feedback?.lessonId === lesson.id && <p className={`team-workspace-feedback ${feedback.error ? 'is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
        {expanded && <div className="team-workspace-materials" id={`team-materials-${lesson.id}`}>
          <div className="team-workspace-package-summary"><span className={video.asset || video.link ? 'is-ready' : ''}>{video.asset || video.link ? <Check size={15} /> : <Film size={15} />}Видео {video.asset || video.link ? 'доступно' : 'не добавлено'}</span><span className={lessonHasHomework(course, lesson) ? 'is-ready' : ''}>{lessonHasHomework(course, lesson) ? <Check size={15} /> : <FileText size={15} />}ДЗ {lessonHasHomework(course, lesson) ? 'доступно' : 'не добавлено'}</span>{lesson.submittedAt && <small>Впервые передан: {stampLabel(lesson.submittedAt, course.timezone)}</small>}</div>
          {assets.length > 0 && <section className="team-workspace-files" aria-label={`Файлы урока ${lesson.code}`}>{groups.map(group => { const files = assets.filter(asset => asset.kind === group.kind); return files.length ? <div className="team-workspace-file-group" key={group.kind}><h3>{group.label}</h3>{files.map(asset => assetRow(asset, lesson))}</div> : null; })}</section>}
          {lesson.links.length > 0 && <section className="team-workspace-links"><h3>Ссылки к уроку</h3>{lesson.links.map((link, index) => { const href = safeUrl(link.url); return <div className="team-workspace-resource" key={`${link.url}-${index}`}><Link2 size={17} /><div><strong>{link.name || 'Ссылка к уроку'}</strong><small>{link.url}</small></div>{href && <a className="team-workspace-file-action" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Открыть ссылку: ${link.name || lesson.code}`}>Открыть<ArrowUpRight size={15} /></a>}</div>; })}</section>}
          {hasTexts && <div className="team-workspace-text-actions"><div><strong>Тексты урока</strong><small>План, задания, тайм-коды и список материалов. Видеофайлы остаются отдельно.</small></div><div className="team-workspace-actions"><button type="button" className="team-workspace-secondary" onClick={() => void copyTexts(lesson)}><Copy size={15} />Скопировать тексты</button><button type="button" className="team-workspace-secondary" onClick={() => downloadTexts(lesson)}><ArrowDownToLine size={15} />Скачать .txt</button></div></div>}
          {lesson.outline.trim() && <section className="team-workspace-text"><h3>План урока</h3><p>{lesson.outline}</p></section>}
          {homework.text.length > 0 && <section className="team-workspace-text"><h3>Домашнее задание</h3><ol>{homework.text.map((text, index) => <li key={index}>{text}</li>)}</ol></section>}
          {lesson.timecodes.trim() && <section className="team-workspace-text team-workspace-timecodes"><div><h3>Тайм-коды</h3><span className={timecodesChecked ? 'is-ready' : ''}>{timecodesChecked ? 'Проверены' : 'Черновик'}</span></div><pre>{lesson.timecodes}</pre></section>}
          {!assets.length && !lesson.links.length && !hasTexts && <p className="team-workspace-muted">Материалы пока не добавлены. Открой карточку урока, чтобы уточнить комплект.</p>}
        </div>}
      </article>;
    })}</div>
    <p className="team-workspace-footnote">Ссылки «Открыть папку» ведут в общую папку Dropbox: нужный файл следует найти по имени. Отметка «Ушло в работу» сохраняет реального исполнителя и время.</p>
  </section>;
}
