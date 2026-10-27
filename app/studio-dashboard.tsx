'use client';

import type { ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CircleDashed } from 'lucide-react';
import type { Course, Lesson } from './studio-model';
import { getDeliveryStatus, getMetrics, today, prepDate } from './studio-utils';
import { ProgressChart } from './studio-charts';
import './dashboard.css';

type View = 'overview' | 'program' | 'schedule' | 'materials' | 'team';
type Props = { course: Course; onOpenLesson: (id: string) => void; onNavigate: (view: View) => void; command?: ReactNode };
const asTime = (date: string) => Date.parse(`${date}T12:00:00Z`);
const formatDate = (date: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(asTime(date)));
const plural = (n: number, one: string, few: string, many: string) => n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
const hasHomework = (lesson: Lesson) => lesson.homework.some(task => task.trim());

export default function StudioDashboard({ course, onOpenLesson, onNavigate, command }: Props) {
  const now = today(course.timezone);
  const metrics = getMetrics(course);
  const { count, recorded, remaining, percent } = metrics;
  const lessons = [...course.lessons].sort((a, b) => a.order - b.order);
  const pending = lessons.filter(lesson => !lesson.recordedOn);
  const planned = [...pending].sort((a, b) => (a.scheduledDate || '9999').localeCompare(b.scheduledDate || '9999') || a.order - b.order);
  const next = metrics.prepDue[0] || metrics.nextLesson || pending[0] || null;
  const nextPrep = next ? prepDate(next) : null;
  const nextDelivery = metrics.nextDelivery;
  const handedOff = lessons.filter(lesson => lesson.submittedAt || lesson.stage !== 'assembling').length;
  const recordedMinutes = Math.round(metrics.minutes);
  const duration = recordedMinutes >= 60 ? `${Math.floor(recordedMinutes / 60)} ч${recordedMinutes % 60 ? ` ${recordedMinutes % 60} мин` : ''}` : `${recordedMinutes} мин`;
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: 'UTC' }).format(new Date(asTime(now)));
  const upcoming = pending.length ? planned.slice(0, 3) : lessons.filter(lesson => lesson.recordedOn && lesson.recordedOn <= now).slice(-3);
  const moduleName = (lesson: Lesson) => course.modules.find(module => module.id === lesson.moduleId)?.title || 'Без модуля';
  const needsPreparation = !!next && (!next.outlineReady || !hasHomework(next) || (next.slidesRequired && !next.slidesReady));
  const missedRecording = !!next?.scheduledDate && next.scheduledDate < now;
  const actionLabel = !next?.scheduledDate ? 'назначить запись' : missedRecording ? 'уточнить запись' : !next.outlineReady ? 'закончить план' : !hasHomework(next) ? 'добавить задание' : next.slidesRequired && !next.slidesReady ? 'подготовить презентацию' : 'записать урок';
  const assemblingRecorded = metrics.stageCounts.assembling;

  const attentions: { lesson: Lesson; text: string }[] = [];
  const addAttention = (lesson: Lesson, text: string) => { if (!attentions.some(item => item.lesson.id === lesson.id)) attentions.push({ lesson, text }); };
  metrics.overdueDelivery.forEach(lesson => addAttention(lesson, `${getDeliveryStatus(lesson, course.timezone, now).label} · сдача до ${formatDate(lesson.deliveryDeadline!)}`));
  metrics.overdueRecords.forEach(lesson => addAttention(lesson, `Запись была запланирована на ${formatDate(lesson.scheduledDate!)}`));
  metrics.deliveryConflicts.forEach(lesson => addAttention(lesson, `Запись позже срока сдачи ${formatDate(lesson.deliveryDeadline!)}`));
  lessons.filter(lesson => lesson.changesPending).forEach(lesson => addAttention(lesson, 'Есть изменения после передачи комплекта'));
  metrics.prepDue.forEach(lesson => addAttention(lesson, !lesson.outlineReady ? 'Подготовить план к записи' : 'Подготовить презентацию к записи'));
  lessons.filter(lesson => lesson.recordedOn && lesson.recordedOn <= now && lesson.stage === 'assembling' && !hasHomework(lesson)).forEach(lesson => addAttention(lesson, 'Добавить домашнее задание перед передачей'));

  return <div className="studio-dashboard">
    <header className="studio-home-heading">
      <div><p className="studio-eyebrow">{course.isDemo ? 'Демонстрационный курс' : 'Текущий курс'}</p><h1>{course.title}</h1><p className="studio-home-subtitle">{course.subtitle || 'От отдельных записей — к готовому курсу.'}</p></div>
      <div className="studio-home-date"><strong>{formatDate(now)}, {weekday}</strong><span>{course.timezone}</span></div>
    </header>

    <section className="studio-home-summary" aria-label="Прогресс курса">
      <div className="studio-home-recorded"><div className="studio-home-progress-caption"><strong>{recorded} из {count} {plural(count, 'урока', 'уроков', 'уроков')} записано</strong><span>{percent}%</span></div><div className="studio-home-progress-track" role="progressbar" aria-label="Записанные уроки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${recorded} из ${count} уроков`}><i style={{ width: `${percent}%` }} /></div></div>
      <div className="studio-home-mini-stat"><strong>{handedOff}</strong><span>передано команде</span></div>
      <div className="studio-home-mini-stat"><strong>{metrics.pace.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}<small> в неделю</small></strong><span title={metrics.paceLabel}>средний темп · {metrics.paceLabel}</span></div>
      <div className="studio-home-mini-stat"><strong>{course.baselineLockedAt ? `+${metrics.addedCount}` : count} {plural(course.baselineLockedAt ? metrics.addedCount : count, 'тема', 'темы', 'тем')}</strong><span>{course.baselineLockedAt ? `к исходным ${course.initialPlannedCount} ${plural(course.initialPlannedCount, 'уроку', 'урокам', 'урокам')}` : 'первоначальный план не закреплён'}</span></div>
    </section>

    {command && <div className="studio-home-command">{command}</div>}

    <div className="studio-home-focus">
      <section className="studio-home-next" aria-label="Следующее действие">
        {next ? <>
          <div className="studio-home-next-top"><p className="studio-eyebrow">Следующее действие · {actionLabel}</p><span className="studio-home-code">{next.code}</span></div>
          <h2>{next.title}</h2>
          <p className="studio-home-next-copy">{missedRecording ? 'Если урок уже записан, укажи фактическую дату. Если запись перенесена — обнови текущий план.' : !next.scheduledDate ? 'Назначь день записи. Дата подготовки появится автоматически за два дня до неё.' : needsPreparation ? 'Собери план, задание и нужные материалы к дню подготовки.' : 'Материалы подготовлены. После записи укажи фактическую дату в карточке урока.'}</p>
          <div className="studio-home-next-dates"><div><span>Подготовить до · D−2</span><strong>{nextPrep ? formatDate(nextPrep) : 'После выбора даты'}</strong></div><div><span>Запись</span><strong>{next.scheduledDate ? formatDate(next.scheduledDate) : 'Дата не назначена'}</strong></div></div>
          <div className="studio-home-checks">
            <span className={next.outlineReady ? 'is-ready' : 'is-waiting'}>{next.outlineReady ? <Check size={14} /> : <CircleDashed size={14} />}План {next.outlineReady ? 'готов' : 'в работе'}</span>
            <span className={hasHomework(next) ? 'is-ready' : 'is-waiting'}>{hasHomework(next) ? <Check size={14} /> : <CircleDashed size={14} />}ДЗ {hasHomework(next) ? 'готово' : 'не добавлено'}</span>
            <span className={!next.slidesRequired ? 'is-optional' : next.slidesReady ? 'is-ready' : 'is-waiting'}>{next.slidesRequired && (next.slidesReady ? <Check size={14} /> : <CircleDashed size={14} />)}{!next.slidesRequired ? 'Без презентации' : next.slidesReady ? 'Презентация готова' : 'Презентация в работе'}</span>
          </div>
          <button type="button" className="studio-home-primary" onClick={() => onOpenLesson(next.id)}>{!next.scheduledDate ? 'Назначить дату' : needsPreparation && !missedRecording ? 'Продолжить подготовку' : 'Открыть урок'}<ArrowUpRight size={17} /></button>
        </> : <>
          <div className="studio-home-next-top"><p className="studio-eyebrow">Следующее действие</p><Check size={18} /></div>
          <h2>{count ? 'Все уроки записаны' : 'Начни с программы курса'}</h2>
          <p className="studio-home-next-copy">{count ? assemblingRecorded > 0 ? 'Теперь можно собрать оставшиеся комплекты и передать их команде.' : 'Следи за размещением и изменениями комплектов в очереди команды.' : 'Добавь темы и модули. Затем выбери даты записи и сроки передачи комплектов.'}</p>
          <button type="button" className="studio-home-primary" onClick={() => onNavigate(count ? assemblingRecorded > 0 ? 'program' : 'team' : 'program')}>{count ? assemblingRecorded > 0 ? 'Собрать комплекты' : 'Открыть очередь команды' : 'Открыть программу'}<ArrowUpRight size={17} /></button>
        </>}
      </section>

      <aside className="studio-home-delivery" aria-label="Ближайший срок передачи комплекта">
        <p className="studio-eyebrow">Ближайшая сдача комплекта</p>
        {nextDelivery?.deliveryDeadline ? <>
          <div className="studio-home-deadline-date">{formatDate(nextDelivery.deliveryDeadline)}</div>
          <p className="studio-home-code">{nextDelivery.code}{nextDelivery.recordedOn ? ` · записан ${formatDate(nextDelivery.recordedOn)}` : ' · ещё не записан'}</p>
          <h2>{nextDelivery.title}</h2>
          <p className="studio-home-delivery-status">{getDeliveryStatus(nextDelivery, course.timezone, now).label}</p>
          <p className="studio-home-delivery-copy">Проверь видео, готовый план, домашнее задание и презентацию, если она нужна.</p>
          <button type="button" className="studio-text-link" onClick={() => onOpenLesson(nextDelivery.id)}>Проверить комплект<ArrowRight size={16} /></button>
        </> : <>
          <h2 className="studio-home-no-deadline">{lessons.some(lesson => lesson.stage === 'assembling' && !lesson.submittedAt) ? 'Сроки ещё не назначены' : count ? 'Нет ожидающих сдач' : 'У каждого урока свой срок'}</h2>
          <p className="studio-home-delivery-copy">{count ? 'Крайний срок сдачи можно задать в карточке урока.' : 'После добавления уроков назначь сроки передачи полных комплектов.'}</p>
          <button type="button" className="studio-text-link" onClick={() => onNavigate('program')}>Открыть программу<ArrowRight size={16} /></button>
        </>}
        <div className="studio-home-delivery-note"><CalendarDays size={16} /><span>Срок сдачи задаётся отдельно от графика записи.</span></div>
      </aside>
    </div>

    <div className="studio-home-lower">
      <section className="studio-home-upcoming">
        <div className="studio-home-section-heading"><h3>{pending.length ? 'Ближайшие уроки' : 'Записанные уроки'}</h3><button type="button" className="studio-text-link" onClick={() => onNavigate('program')}>Вся программа<ArrowUpRight size={15} /></button></div>
        {upcoming.length ? <div>{upcoming.map(lesson => <button type="button" className="studio-home-lesson-row" key={lesson.id} onClick={() => onOpenLesson(lesson.id)}><span className="studio-home-code">{lesson.code}</span><span><strong>{lesson.title}</strong><small>{moduleName(lesson)}</small></span><span>{lesson.recordedOn && lesson.recordedOn <= now ? <>Записан<br />{formatDate(lesson.recordedOn)}</> : lesson.scheduledDate ? <>Запись<br />{formatDate(lesson.scheduledDate)}</> : 'Без даты'}</span></button>)}</div> : <p className="studio-home-empty-copy">Уроки появятся здесь после добавления в программу.</p>}
      </section>
      <section className="studio-home-team">
        <div className="studio-home-section-heading"><h3>Передача команде</h3><button type="button" className="studio-text-link" onClick={() => onNavigate('team')} aria-label="Открыть команду и очередь размещения"><ArrowUpRight size={17} /></button></div>
        <div className="studio-home-team-counts"><div><strong>{metrics.allStageCounts.ready}</strong><span>ожидают работы</span></div><div><strong>{metrics.allStageCounts.taken}</strong><span>в работе</span></div><div><strong>{metrics.allStageCounts.published}</strong><span>размещено</span></div></div>
        <p className="studio-home-team-note">{assemblingRecorded > 0 ? `${assemblingRecorded} ${plural(assemblingRecorded, 'записанный урок ещё собирается', 'записанных урока ещё собираются', 'записанных уроков ещё собираются')}.` : recorded ? 'Все записанные уроки переданы команде.' : 'Собранные комплекты появятся в очереди после передачи.'}</p>
        <button type="button" className="studio-text-link" onClick={() => onNavigate('team')}>Открыть очередь<ArrowRight size={16} /></button>
      </section>
    </div>

    {attentions.length > 0 && <section className="studio-home-attention" aria-label="Требует внимания"><div className="studio-home-section-heading"><h3>Требует внимания <span>{attentions.length}</span></h3></div><div>{attentions.slice(0, 4).map(({ lesson, text }) => <button type="button" key={lesson.id} onClick={() => onOpenLesson(lesson.id)}><span className="studio-home-attention-dot" /><span><strong>{text}</strong><small>{lesson.code} · {lesson.title}</small></span><ArrowUpRight size={16} /></button>)}</div>{attentions.length > 4 && <button type="button" className="studio-text-link" onClick={() => onNavigate('program')}>Ещё {attentions.length - 4} в программе<ArrowRight size={15} /></button>}</section>}

    <section className="studio-home-chart-section" aria-label="Первоначальный график, текущий план и фактические записи">
      <div className="studio-home-section-heading"><h3>Как движется курс</h3><button type="button" className="studio-text-link" onClick={() => onNavigate('schedule')}>График по урокам<ArrowUpRight size={15} /></button></div>
      <ProgressChart course={course} />
      <div className="studio-home-chart-caption"><span>{metrics.baselineFinish ? `Первоначальный финиш: ${formatDate(metrics.baselineFinish)}` : course.baselineLockedAt ? 'В первоначальном плане нет дат записи' : 'Первоначальный график ещё не закреплён'}{metrics.currentFinish ? ` · Текущий: ${formatDate(metrics.currentFinish)}` : ''}</span><span>{metrics.thisWeek} {plural(metrics.thisWeek, 'урок', 'урока', 'уроков')} на этой неделе{recordedMinutes > 0 ? ` · ${duration} записано` : ''}{remaining > 0 ? ` · Осталось ${remaining}` : ''}</span></div>
    </section>
  </div>;
}
