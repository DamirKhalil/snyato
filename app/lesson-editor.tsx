'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, CircleCheck, CircleDashed, Clipboard, Copy, Download, FileText, Film, FolderOpen, Link2, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { STAGE_LABELS, type Course, type Lesson, type StudioAsset, type StudioUser } from './studio-model';
import { getDeliveryStatus } from './studio-utils';
import { mergeLessonDraft } from './lesson-draft';
import './lesson-editor.css';

type Props = {
  course: Course;
  lesson: Lesson;
  onChange: (lesson: Lesson, description: string, base?: Lesson) => Promise<Lesson | void> | Lesson | void;
  onClose: () => void;
  onUpload: (files: File[], lessonId?: string) => Promise<void>;
  onRemoveAsset: (id: string) => void;
  user: StudioUser;
};

const assetLabels: Record<StudioAsset['kind'], string> = {
  video: 'Запись', slides: 'Презентация', file: 'Приложенные файлы', source: 'Исходники', outline: 'План урока',
};
const assetOrder: StudioAsset['kind'][] = ['video', 'slides', 'outline', 'file', 'source'];
type EditorTab = 'plan' | 'homework' | 'materials' | 'timecodes';
const cloneLesson = (lesson: Lesson): Lesson => ({ ...lesson, homework: [...lesson.homework], links: lesson.links.map(link => ({ ...link })) });
const signature = (lesson: Lesson) => JSON.stringify(lesson);

function safeUrl(value: string) {
  if (/^\/api\/assets\/[a-zA-Z0-9_-]+$/.test(value)) return value;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function niceDate(value: string | null) {
  if (!value) return 'Не назначена';
  const date = new Date(value + 'T12:00:00Z');
  return Number.isNaN(date.getTime()) ? 'Не назначена' : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(date);
}
function preparationDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - 2);
  return date.toISOString().slice(0, 10);
}
function fileSize(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ` : `${Math.max(1, Math.round(size / 1024))} КБ`;
}
function videoLinkSignature(links: Lesson['links']) {
  return links.filter(link => /видео|запис/i.test(link.name)).map(link => link.url.trim()).join('|');
}

export default function LessonEditor({ course, lesson, onChange, onClose, onUpload, onRemoveAsset, user }: Props) {
  const [draft, setDraft] = useState<Lesson>(() => cloneLesson(lesson));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closeRequested, setCloseRequested] = useState(false);
  const [copied, setCopied] = useState(false);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [tab, setTab] = useState<EditorTab>(lesson.recordedOn ? 'timecodes' : 'plan');
  const baseRef = useRef(signature(lesson));
  const currentDraftRef = useRef(draft);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const intermediateSaveVersionsRef = useRef(new Set<string>());
  const containerRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const dirty = signature(draft) !== baseRef.current;
  const assets = course.assets.filter(asset => asset.lessonId === draft.id);
  const videos = assets.filter(asset => asset.kind === 'video');
  const selectedVideo = videos.find(asset => asset.id === draft.videoId);
  const staleTimecodes = !!draft.timecodes.trim() && (draft.videoId ? draft.timecodesVideoId !== draft.videoId : !!draft.timecodesVideoId && !draft.timecodesVideoId.startsWith('link:'));
  const hasVideo = !!selectedVideo || draft.links.some(link => /видео|запис/i.test(link.name) && safeUrl(link.url));
  const hasOutline = !!draft.outline.trim() || assets.some(asset => asset.kind === 'outline') || draft.links.some(link => /план|сценарий|outline/i.test(link.name) && safeUrl(link.url));
  const hasSlides = assets.some(asset => asset.kind === 'slides') || draft.links.some(link => /презентац|slides/i.test(link.name) && safeUrl(link.url));
  const readiness = [
    { label: 'Запись', ready: !!draft.recordedOn && hasVideo },
    { label: 'План урока', ready: draft.outlineReady && hasOutline },
    { label: 'Домашнее задание', ready: draft.homework.some(item => item.trim()) },
    { label: draft.slidesRequired ? 'Презентация' : 'Без презентации', ready: !draft.slidesRequired || (draft.slidesReady && hasSlides) },
  ];
  const readyCount = readiness.filter(item => item.ready).length;
  const tabs: { id: EditorTab; label: string }[] = [
    { id: 'plan', label: 'План' },
    { id: 'homework', label: `ДЗ · ${draft.homework.filter(item => item.trim()).length}` },
    { id: 'materials', label: `Материалы · ${assets.length}` },
    { id: 'timecodes', label: 'Тайм-коды' },
  ];
  const delivery = getDeliveryStatus(draft, course.timezone);
  const deliveryUrgent = ['overdue', 'today', 'soon'].includes(delivery.kind);
  const deliveryConflict = !!draft.deliveryDeadline && !!draft.scheduledDate && draft.scheduledDate > draft.deliveryDeadline;
  const todayForCourse = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: course.timezone }).format(new Date());
  currentDraftRef.current = draft;
  onCloseRef.current = onClose;
  busyRef.current = uploading || saving;

  useEffect(() => {
    const next = signature(lesson);
    if (saveInFlightRef.current) {
      intermediateSaveVersionsRef.current.add(next);
      return;
    }
    if (next === baseRef.current) {
      intermediateSaveVersionsRef.current.clear();
      return;
    }
    // A queued upload can render before the save acknowledgement. It is not
    // the saved lesson and must not replace that acknowledgement afterwards.
    if (intermediateSaveVersionsRef.current.has(next)) return;
    intermediateSaveVersionsRef.current.clear();
    if (signature(currentDraftRef.current) === baseRef.current || next === signature(currentDraftRef.current)) {
      baseRef.current = next;
      setDraft(cloneLesson(lesson));
      setRemoteChanged(false);
    } else {
      const result = mergeLessonDraft(JSON.parse(baseRef.current) as Lesson, currentDraftRef.current, lesson);
      if (result.merged) {
        baseRef.current = next;
        setDraft(result.merged);
        setRemoteChanged(false);
      } else {
        setRemoteChanged(true);
      }
    }
  }, [lesson, saving]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollStyle = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    containerRef.current?.querySelector<HTMLButtonElement>('.lesson-editor-close')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (busyRef.current) return;
        if (signature(currentDraftRef.current) !== baseRef.current) setCloseRequested(true);
        else onCloseRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = containerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      const visible = [...(items ?? [])].filter(item => item.getClientRects().length > 0);
      const first = visible[0];
      const last = visible[visible.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = scrollStyle; previous?.focus(); };
  }, []);

  function update<K extends keyof Lesson>(key: K, value: Lesson[K]) {
    setDraft(previous => {
      const next = { ...previous, [key]: value };
      if (key === 'videoId' && value !== previous.videoId) {
        next.timecodesStatus = 'draft';
      }
      if (key === 'links' && videoLinkSignature(value as Lesson['links']) !== videoLinkSignature(previous.links)) {
        next.timecodesStatus = 'draft';
      }
      if (key === 'timecodes' && value !== previous.timecodes) next.timecodesStatus = 'draft';
      return next;
    });
    setError('');
    setNotice('');
  }

  function requestClose() {
    if (uploading || saving) { setNotice(saving ? 'Сохраняем изменения…' : 'Дождись окончания загрузки файлов.'); return; }
    if (dirty) setCloseRequested(true); else onClose();
  }

  function publicationErrors(next: Lesson) {
    const problems: string[] = [];
    if (!next.title.trim()) problems.push('Добавь название урока.');
    if (!next.recordedOn) problems.push('Укажи фактическую дату записи.');
    if (!next.homework.some(item => item.trim())) problems.push('Добавь хотя бы одно домашнее задание.');
    const hasVideo = videos.some(item => item.id === next.videoId) || next.links.some(link => /видео|запис/i.test(link.name) && safeUrl(link.url));
    if (!hasVideo) problems.push('Выбери запись в материалах или добавь ссылку с подписью «Видео урока».');
    if (!next.outlineReady || !(next.outline.trim() || assets.some(item => item.kind === 'outline') || next.links.some(link => /план|сценарий|outline/i.test(link.name) && safeUrl(link.url)))) problems.push('Добавь план урока и отметь его готовым.');
    if (next.slidesRequired && !next.slidesReady) problems.push('Отметь презентацию готовой либо укажи, что она не требуется.');
    if (next.slidesRequired && !assets.some(item => item.kind === 'slides') && !next.links.some(link => /презентац|slides/i.test(link.name) && safeUrl(link.url))) problems.push('Прикрепи презентацию или добавь ссылку на неё.');
    return problems;
  }

  async function commit(stage?: Lesson['stage'], close = false, acceptChanges = false) {
    if (busyRef.current) return;
    if (remoteChanged) { setError('Карточка обновилась. Сначала загрузи актуальную версию, чтобы сохранить изменения без потерь.'); return; }
    const clean: Lesson = {
      ...draft,
      title: draft.title.trim(),
      homework: draft.homework.map(text => text.trim()).filter(Boolean),
      links: draft.links.filter(link => link.name.trim() || link.url.trim()).map(link => ({ name: link.name.trim() || 'Полезная ссылка', url: link.url.trim() })),
      durationMinutes: Math.max(0, Math.min(10000, Number(draft.durationMinutes) || 0)),
      deliveryDeadline: draft.deliveryDeadline || null,
      updatedAt: new Date().toISOString(),
    };
    if (!clean.title) { setError('Укажи название урока.'); return; }
    if (clean.links.some(link => !safeUrl(link.url))) { setError('Для ссылок используй полный адрес, начинающийся с https:// или http://.'); return; }
    const currentDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: course.timezone }).format(new Date());
    if (clean.recordedOn && clean.recordedOn > currentDate) { setError('Фактическая дата записи не может находиться в будущем.'); return; }
    if (stage && stage !== 'assembling') {
      const problems = publicationErrors(clean);
      if (problems.length) { setError(problems.join(' ')); return; }
    }
    if (stage === 'published' && clean.timecodes.trim() && (clean.timecodesStatus !== 'checked' || staleTimecodes)) {
      setError('Проверь оглавление для актуальной записи и отметь тайм-коды проверенными.'); return;
    }
    if (stage) clean.stage = stage;
    if (stage === 'taken') { clean.assignee = user.displayName; clean.takenAt = new Date().toISOString(); }
    if (stage === 'published') { clean.publishedAt = new Date().toISOString(); clean.changesPending = false; }
    else if (acceptChanges) clean.changesPending = false;
    else if (dirty && ['ready', 'taken', 'published'].includes(lesson.stage)) clean.changesPending = true;
    let description = acceptChanges ? `Приняты изменения в ${clean.code}` : stage === 'ready' ? `${clean.code} передан на размещение` : stage === 'taken' ? `${user.displayName} взял(а) ${clean.code} в работу` : stage === 'published' ? `${clean.code} размещён` : `Обновлён ${clean.code}: ${clean.title}`;
    if ((lesson.deliveryDeadline || null) !== clean.deliveryDeadline) {
      const before = lesson.deliveryDeadline || 'не задан';
      const after = clean.deliveryDeadline || 'не задан';
      description += ` · Крайний срок сдачи: ${before} → ${after}`;
    }
    setError('');
    busyRef.current = true;
    saveInFlightRef.current = true;
    intermediateSaveVersionsRef.current.clear();
    intermediateSaveVersionsRef.current.add(signature(lesson));
    setSaving(true);
    try {
      const saved = await onChange(clean, description, JSON.parse(baseRef.current) as Lesson);
      const acknowledged = cloneLesson(saved || clean);
      baseRef.current = signature(acknowledged);
      currentDraftRef.current = acknowledged;
      setDraft(acknowledged);
      setRemoteChanged(false);
      setNotice(stage ? STAGE_LABELS[clean.stage] : 'Изменения сохранены');
      setCloseRequested(false);
      if (close) onClose();
    } catch (cause) {
      intermediateSaveVersionsRef.current.clear();
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить изменения. Твои правки остались в карточке.');
      setNotice('');
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true); setError(''); setNotice('Загружаем материалы…');
    try { await onUpload(files, draft.id); setNotice('Материалы добавлены к уроку.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось загрузить материалы. Повтори попытку.'); setNotice(''); }
    finally { setUploading(false); if (uploadRef.current) uploadRef.current.value = ''; }
  }

  async function copyTimecodes() {
    try { await navigator.clipboard.writeText(draft.timecodes); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setError('Не удалось скопировать автоматически. Выдели текст оглавления и скопируй его.'); }
  }

  return (
    <div className="lesson-editor-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={containerRef} className="lesson-editor" role="dialog" aria-modal="true" aria-labelledby="lesson-editor-title">
        <header className="lesson-editor-header">
          <div className="lesson-editor-header-inner">
            <div className="lesson-editor-breadcrumb"><button type="button" onClick={requestClose} disabled={saving} className="lesson-editor-text-button"><ArrowLeft size={16} />К курсу</button><span>/</span><span>{course.title}</span></div>
            <button type="button" className="lesson-editor-close" onClick={requestClose} disabled={saving} aria-label="Закрыть карточку урока"><X size={21} /></button>
            <div className="lesson-editor-heading"><p className="lesson-editor-code">{draft.code} <span>· {course.modules.find(module => module.id === draft.moduleId)?.title || 'Модуль'}</span></p><h2 id="lesson-editor-title">{draft.title || 'Новый урок'}</h2><div className="lesson-editor-title-badges"><span className={`lesson-editor-stage is-${draft.stage}`}><span />{STAGE_LABELS[draft.stage]}</span>{draft.recordedOn && <span className="lesson-editor-recorded">Записан {niceDate(draft.recordedOn)}</span>}</div></div>
          </div>
        </header>

        <fieldset className="lesson-editor-body" disabled={saving} aria-busy={saving}>
          <input ref={uploadRef} type="file" multiple hidden onChange={event => void upload(Array.from(event.target.files ?? []))} />
          {remoteChanged && <div className="lesson-editor-alert" role="alert">Карточка обновилась в другом окне. Твои правки остались здесь. <button type="button" onClick={() => { baseRef.current = signature(lesson); setDraft(cloneLesson(lesson)); setRemoteChanged(false); setError(''); }}>Загрузить актуальную версию</button></div>}
          {draft.changesPending && <div className="lesson-editor-change-note"><span className="lesson-editor-dot" />В переданном комплекте есть изменения.<button type="button" onClick={() => commit(undefined, false, true)}>Изменения учтены <Check size={14} /></button></div>}

          <div className="lesson-editor-date-strip" aria-label="Ближайшие даты урока">
            <div><span>{draft.recordedOn ? 'Подготовка к записи' : 'Подготовить до'}</span><strong>{niceDate(preparationDate(draft.scheduledDate))}</strong><small>За два календарных дня</small></div>
            <div><span>{draft.recordedOn ? 'Фактически записан' : 'Текущая запись'}</span><strong>{niceDate(draft.recordedOn || draft.scheduledDate)}</strong><small>{draft.recordedOn ? draft.durationMinutes ? `${draft.durationMinutes} мин · факт записи` : 'Факт записи' : 'По текущему графику'}</small></div>
            <div className={deliveryUrgent ? 'is-urgent' : ''}><span>Сдать полный комплект до</span><strong>{draft.deliveryDeadline ? niceDate(draft.deliveryDeadline) : 'Не задано'}</strong><small>{delivery.label}</small></div>
          </div>
          {deliveryConflict && <p className="lesson-editor-delivery-conflict" role="status">Запись назначена на {niceDate(draft.scheduledDate)}, позже срока сдачи {niceDate(draft.deliveryDeadline || null)}. Проверь даты: к сдаче нужен полный комплект.</p>}

          <div className="lesson-editor-workspace">
            <div className="lesson-editor-main">
              <details className="lesson-editor-identity"><summary>Название и модуль <ChevronDown size={15} /></summary><div><label className="lesson-editor-field"><span>Название урока</span><input value={draft.title} onChange={event => update('title', event.target.value)} placeholder="Что мы создадим на этом занятии?" maxLength={240} /></label><label className="lesson-editor-field"><span>Модуль</span><span className="lesson-editor-select-wrap"><select value={draft.moduleId} onChange={event => update('moduleId', event.target.value)}>{course.modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}</select><ChevronDown size={16} /></span></label></div></details>
              <div className="lesson-editor-workcard">
                <div className="lesson-editor-tabs" role="tablist" aria-label="Разделы урока" onKeyDown={event => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const index = tabs.findIndex(item => item.id === tab);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                  setTab(tabs[next].id);
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                }}>{tabs.map(item => <button key={item.id} type="button" id={`lesson-${draft.id}-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`lesson-${draft.id}-panel`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
                <div className="lesson-editor-tab-content" id={`lesson-${draft.id}-panel`} role="tabpanel" aria-labelledby={`lesson-${draft.id}-tab-${tab}`} tabIndex={0}>
                  {tab === 'plan' && <section className="lesson-editor-section">
                    <div className="lesson-editor-section-title"><h3>План урока</h3><span className={`lesson-editor-section-tag ${draft.outlineReady && hasOutline ? 'is-ready' : ''}`}>{draft.outlineReady && hasOutline ? 'Готов' : 'В работе'}</span></div>
                    <label className="lesson-editor-field"><span>Тезисы и последовательность <small>Для автора и команды</small></span><textarea className="lesson-editor-textarea" value={draft.outline} onChange={event => update('outline', event.target.value)} placeholder="Тезисы, последовательность демонстраций, что важно объяснить…" rows={10} /></label>
                    <label className="lesson-editor-check"><input type="checkbox" checked={draft.outlineReady} onChange={event => update('outlineReady', event.target.checked)} /><span>План готов к записи<small>Отметка готовности сохраняется отдельно от текста.</small></span></label>
                    <p className="lesson-editor-help">План можно написать здесь, прикрепить файлом или добавить ссылку в материалах. Домашние задания и материалы доступны до записи.</p>
                    {draft.scheduledDate && <p className="lesson-editor-prep-date">Подготовить план{draft.slidesRequired ? ' и презентацию' : ''} до <strong>{niceDate(preparationDate(draft.scheduledDate))}</strong>.</p>}
                  </section>}

                  {tab === 'homework' && <section className="lesson-editor-section">
                    <div className="lesson-editor-section-title"><h3>Задания для учеников</h3><button type="button" className="lesson-editor-text-button" onClick={() => update('homework', [...draft.homework, ''])}><Plus size={16} />Добавить</button></div>
                    {draft.homework.length ? draft.homework.map((homework, index) => <div className="lesson-editor-homework" key={index}><div><label htmlFor={`lesson-${draft.id}-homework-${index}`}>Задание {index + 1}</label><button type="button" className="lesson-editor-text-button" aria-label={`Удалить задание ${index + 1}`} onClick={() => update('homework', draft.homework.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} />Убрать</button></div><textarea id={`lesson-${draft.id}-homework-${index}`} value={homework} rows={5} onChange={event => update('homework', draft.homework.map((text, itemIndex) => itemIndex === index ? event.target.value : text))} placeholder="Что сделать ученику и какой результат прислать?" /></div>) : <button type="button" className="lesson-editor-empty-action" onClick={() => update('homework', [''])}><Plus size={20} /><span>Добавить первое задание</span></button>}
                    <p className="lesson-editor-help">Задания можно подготовить до записи. При передаче специалист получит сохранённую редакцию вместе с материалами урока.</p>
                  </section>}

                  {tab === 'materials' && <section className="lesson-editor-section">
                    <div className="lesson-editor-section-title"><h3>Материалы урока</h3><button type="button" className="lesson-editor-text-button" disabled={uploading} onClick={() => uploadRef.current?.click()}><Upload size={16} />{uploading ? 'Загружаем…' : 'Добавить файлы'}</button></div>
                    {!hasVideo && <div className="lesson-editor-video-summary"><Film size={20} /><div><strong>Запись ещё не выбрана</strong><span>План, задания и приложения можно подготовить заранее.</span></div></div>}
                    {assets.length === 0 && <div className="lesson-editor-empty-materials"><FolderOpen size={26} /><span>Видео, презентации, PDF и таблицы появятся здесь.</span></div>}
                    {assetOrder.map(kind => {
                      const group = assets.filter(asset => asset.kind === kind);
                      if (!group.length) return null;
                      return <div className="lesson-editor-asset-group" key={kind}><h4>{assetLabels[kind]}</h4>{group.map(asset => <div key={asset.id} className={`lesson-editor-asset ${asset.id === draft.videoId ? 'is-selected' : ''}`}><span className="lesson-editor-file-icon">{kind === 'video' ? <Film size={19} /> : <FileText size={19} />}</span><div className="lesson-editor-asset-name"><strong>{asset.name}</strong><small>{fileSize(asset.size)}{asset.source === 'dropbox' ? ' · Dropbox' : ''}{asset.id === draft.videoId ? ' · Актуальная запись' : ''}</small></div><div className="lesson-editor-asset-actions">{kind === 'video' && <button type="button" onClick={() => update('videoId', asset.id)} className="lesson-editor-pick-video" aria-pressed={draft.videoId === asset.id}>{draft.videoId === asset.id ? <><Check size={14} />Выбрано</> : 'Выбрать'}</button>}{safeUrl(asset.url) && <a className="lesson-editor-icon-button" href={safeUrl(asset.url)} target="_blank" rel="noopener noreferrer" download={asset.name} aria-label={`Открыть ${asset.name}`}><Download size={16} /></a>}{user.role === 'owner' && <button type="button" className="lesson-editor-icon-button" onClick={() => onRemoveAsset(asset.id)} aria-label={`Удалить файл ${asset.name}`}><Trash2 size={15} /></button>}</div></div>)}</div>;
                    })}
                    <p className="lesson-editor-help">Видео до 10 ГБ можно загрузить файлом. Для записи в Dropbox или другом сервисе добавь ссылку с подписью «Видео урока».</p>
                    <div className="lesson-editor-presentation"><h4>Презентация</h4><label className="lesson-editor-check"><input type="checkbox" checked={draft.slidesRequired} onChange={event => update('slidesRequired', event.target.checked)} /><span>Для урока нужна презентация<small>Изменение не удаляет уже добавленные файлы.</small></span></label>{draft.slidesRequired ? <label className="lesson-editor-check"><input type="checkbox" checked={draft.slidesReady} onChange={event => update('slidesReady', event.target.checked)} /><span>Презентация готова к записи<small>Прикрепи PPTX или PDF либо добавь ссылку на презентацию.</small></span></label> : <p className="lesson-editor-help">В этом уроке презентация не предусмотрена.</p>}</div>
                    <div className="lesson-editor-links-heading"><h4>Ссылки и пояснения</h4><button type="button" className="lesson-editor-text-button" onClick={() => update('links', [...draft.links, { name: '', url: '' }])}><Link2 size={15} />Добавить ссылку</button></div>
                    {draft.links.map((link, index) => <div className="lesson-editor-link-row" key={index}><input value={link.name} aria-label={`Подпись ссылки ${index + 1}`} placeholder="Название или пояснение" onChange={event => update('links', draft.links.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input type="url" value={link.url} aria-label={`Адрес ссылки ${index + 1}`} placeholder="https://…" onChange={event => update('links', draft.links.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} /><button type="button" className="lesson-editor-icon-button" aria-label={`Удалить ссылку ${index + 1}`} onClick={() => update('links', draft.links.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button></div>)}
                  </section>}

                  {tab === 'timecodes' && <section className="lesson-editor-section">
                    <div className="lesson-editor-section-title"><h3>Оглавление записи</h3><span className={`lesson-editor-section-tag ${draft.timecodesStatus === 'checked' && !staleTimecodes ? 'is-ready' : ''}`}>{draft.timecodesStatus === 'checked' && !staleTimecodes ? 'Проверены' : 'Черновик'}</span></div>
                    <div className="lesson-editor-video-summary"><Film size={20} /><div><strong>{selectedVideo ? selectedVideo.name : hasVideo ? 'Видео по ссылке в материалах' : 'Запись ещё не выбрана'}</strong><span>{selectedVideo && draft.durationMinutes ? `${draft.durationMinutes} мин · актуальная запись` : hasVideo ? 'Тайм-коды для актуальной записи урока' : 'Добавь запись в разделе «Материалы».'}</span></div>{!hasVideo && <button type="button" className="lesson-editor-text-button" onClick={() => setTab('materials')}>К материалам <ArrowRight size={14} /></button>}</div>
                    {staleTimecodes && <div className="lesson-editor-warning" role="status">Оглавление связано с другой версией записи. Проверь временные отметки.</div>}
                    <label className="lesson-editor-field"><span>Тайм-код — название раздела</span><textarea className="lesson-editor-textarea lesson-editor-timecodes" value={draft.timecodes} onChange={event => update('timecodes', event.target.value)} rows={10} placeholder={'00:00 Что создадим на занятии\n04:20 Выбираем рабочую задачу\n12:35 Переходим к практике'} /></label>
                    <div className="lesson-editor-timecode-footer"><button type="button" className="lesson-editor-text-button" onClick={() => void copyTimecodes()} disabled={!draft.timecodes.trim()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Скопировано' : 'Копировать оглавление'}</button><span><Clipboard size={15} />Ручная разметка</span></div>
                    <label className="lesson-editor-check"><input type="checkbox" disabled={!hasVideo || !draft.timecodes.trim()} checked={draft.timecodesStatus === 'checked' && !staleTimecodes} onChange={event => setDraft(previous => ({ ...previous, timecodesStatus: event.target.checked ? 'checked' : 'draft', timecodesVideoId: event.target.checked ? previous.videoId : previous.timecodesVideoId }))} /><span>Тайм-коды проверены<small>{hasVideo ? 'Сверены с актуальной записью урока.' : 'Сначала выбери запись или добавь ссылку на видео в материалах.'}</small></span></label>
                    <p className="lesson-editor-help">Оглавление — отдельный материал для учеников. Автоматическая расшифровка пока не подключена. При замене записи тайм-коды нужно проверить заново.</p>
                  </section>}
                </div>
              </div>
            </div>

            <aside className="lesson-editor-sidebar" aria-label="Готовность, график и передача урока">
              <section className="lesson-editor-sidebar-section"><div className="lesson-editor-section-title"><h3>Готовность комплекта</h3><span className="lesson-editor-readiness-count">{readyCount} / {readiness.length}</span></div><div className="lesson-editor-readiness">{readiness.map(item => <div key={item.label} className={item.ready ? 'is-ready' : ''}>{item.ready ? <CircleCheck size={16} /> : <CircleDashed size={16} />}<span>{item.label}</span></div>)}</div><p className="lesson-editor-help">{readyCount === readiness.length ? 'Обязательный состав комплекта собран.' : 'Для передачи нужны запись, готовый план, задание и презентация, если она требуется.'}</p>{draft.timecodes.trim() && <p className="lesson-editor-timecodes-note">Тайм-коды: {draft.timecodesStatus === 'checked' && !staleTimecodes ? 'проверены' : 'черновик'}. Проверка обязательна до размещения.</p>}</section>
              <section className="lesson-editor-sidebar-section lesson-editor-handoff"><h3>Передача команде</h3><div className="lesson-editor-handoff-content"><strong>{STAGE_LABELS[draft.stage]}</strong><p>{draft.stage === 'assembling' ? 'Собери комплект и передай его на размещение.' : draft.stage === 'ready' ? 'Комплект доступен команде. Специалист может забрать его в работу.' : draft.stage === 'taken' ? `${draft.assignee || 'Специалист'}${draft.takenAt ? ` · с ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: course.timezone }).format(new Date(draft.takenAt))}` : ''}` : `${draft.assignee || 'Команда'} завершил(а) размещение.`}</p>{draft.submittedAt && <p className="lesson-editor-submitted">Впервые передан<br />{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: course.timezone }).format(new Date(draft.submittedAt))}</p>}{draft.stage === 'assembling' && <button type="button" className="lesson-editor-workflow-button" onClick={() => commit('ready')} disabled={uploading || remoteChanged}>Передать комплект<ArrowRight size={17} /></button>}{draft.stage === 'ready' && <button type="button" className="lesson-editor-workflow-button" onClick={() => commit('taken')} disabled={uploading || remoteChanged}>Беру в работу<Check size={17} /></button>}{draft.stage === 'taken' && <button type="button" className="lesson-editor-workflow-button" onClick={() => commit('published')} disabled={uploading || remoteChanged}>Размещено<CheckCheck size={17} /></button>}{draft.stage === 'published' && <span className="lesson-editor-published-stamp"><CheckCheck size={18} />Размещено</span>}</div></section>
              <section className="lesson-editor-sidebar-section lesson-editor-schedule"><h3>График урока</h3><div className="lesson-editor-baseline"><span>Первоначальный план</span><strong>{niceDate(draft.baselineDate)}</strong><small>{draft.baselineDate ? 'Сохранён при утверждении графика' : course.baselineLockedAt ? 'Урок добавлен после утверждения' : 'График ещё не утверждён'}</small></div><label className="lesson-editor-field"><span>Текущая дата записи</span><input type="date" disabled={!!lesson.recordedOn} value={draft.scheduledDate ?? ''} onInput={event => update('scheduledDate', event.currentTarget.value || null)} onChange={event => update('scheduledDate', event.target.value || null)} /></label><label className="lesson-editor-field"><span>Фактически записан</span><input type="date" max={todayForCourse} value={draft.recordedOn ?? ''} onInput={event => update('recordedOn', event.currentTarget.value || null)} onChange={event => update('recordedOn', event.target.value || null)} /></label><label className="lesson-editor-field"><span>Длительность, минут</span><input type="number" min="0" max="10000" value={draft.durationMinutes || ''} onChange={event => update('durationMinutes', Number(event.target.value))} placeholder="Например, 45" /></label><p className="lesson-editor-help">{lesson.recordedOn ? 'Текущая дата уже записанного урока сохранена.' : 'Перенос записи пересчитывает подготовку D−2.'} Факт записи учитывается в прогрессе и может отличаться от даты загрузки видео.</p><div className={`lesson-editor-delivery ${deliveryUrgent ? 'is-urgent' : ''}`}><label className="lesson-editor-field"><span>Сдать комплект до</span><input type="date" value={draft.deliveryDeadline ?? ''} onInput={event => update('deliveryDeadline', event.currentTarget.value || null)} onChange={event => update('deliveryDeadline', event.target.value || null)} /></label><strong>{delivery.label}</strong><p>Полный комплект должен быть передан техспециалисту к этой дате. Перенос записи не меняет дедлайн.</p></div></section>
              <section className="lesson-editor-history"><h3>История урока</h3>{course.history.filter(entry => entry.text.includes(draft.code)).slice(0,3).map(entry => <div key={entry.id}><time dateTime={entry.at}>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: course.timezone }).format(new Date(entry.at))}</time><p>{entry.text}</p></div>)}{!course.history.some(entry => entry.text.includes(draft.code)) && <p className="lesson-editor-help">Изменения урока появятся здесь после сохранения.</p>}</section>
            </aside>
          </div>
        </fieldset>

        <footer className="lesson-editor-footer"><div className="lesson-editor-footer-inner">
          <div className="lesson-editor-feedback" aria-live="polite">{error ? <p className="lesson-editor-error" role="alert">{error}</p> : saving ? <p>Сохраняем изменения…</p> : closeRequested ? <p>В карточке есть несохранённые изменения.</p> : notice ? <p>{notice}</p> : <p>{dirty ? 'Есть несохранённые изменения' : 'Изменений нет'}</p>}</div>
          <div className="lesson-editor-footer-actions">{closeRequested ? <><button type="button" className="lesson-editor-secondary" disabled={saving || uploading} onClick={() => onClose()}>Закрыть без сохранения</button><button type="button" className="lesson-editor-secondary" disabled={saving} onClick={() => setCloseRequested(false)}>Продолжить</button><button type="button" className="lesson-editor-save" onClick={() => void commit(undefined, true)} disabled={uploading || saving || remoteChanged}><Save size={16} />Сохранить и закрыть</button></> : <><button type="button" className="lesson-editor-secondary" disabled={saving} onClick={requestClose}>Закрыть</button><button type="button" className="lesson-editor-save" onClick={() => void commit()} disabled={!dirty || uploading || saving || remoteChanged}><Save size={16} />Сохранить изменения</button></>}</div>
        </div></footer>
      </div>
    </div>
  );
}
