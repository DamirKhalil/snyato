'use client';

import { useEffect, useRef, useState } from 'react';
import type { Course } from './studio-model';
import { getDeliveryStatus } from './studio-utils';
import './dashboard.css';

const DAY = 86400000;
const asTime = (date: string) => Date.parse(`${date}T12:00:00Z`);
function today(tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (key: string) => parts.find(p => p.type === key)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const label = (time: number) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(time)).replace('.', '');

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(Math.max(260, Math.floor(node.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  });
  return { ref, width };
}

export function ProgressChart({ course }: { course: Course }) {
  const { ref, width } = useWidth();
  const now = asTime(today(course.timezone));
  const baseline = course.lessons.flatMap(l => l.baselineDate ? [asTime(l.baselineDate)] : []).sort((a,b) => a-b);
  const current = course.lessons.flatMap(l => l.scheduledDate ? [asTime(l.scheduledDate)] : []).sort((a,b) => a-b);
  const actual = course.lessons.flatMap(l => l.recordedOn && asTime(l.recordedOn) <= now ? [asTime(l.recordedOn)] : []).sort((a,b) => a-b);
  const dates = [...baseline, ...current, ...actual];
  if (!dates.length) return <div className="studio-chart-empty"><span className="studio-crosshair">＋</span><p>Здесь появится движение курса</p><span>Назначь даты записи — и план станет видимым.</span></div>;
  const min = Math.min(...dates, now) - DAY;
  const max = Math.max(...dates, now) + DAY;
  const height = 270, left = 35, right = 18, top = 24, bottom = 40;
  const maxCount = Math.max(course.lessons.length, baseline.length, current.length, actual.length, 1);
  const x = (d: number) => left + (d-min)/(max-min)*(width-left-right);
  const y = (n: number) => height-bottom - n/maxCount*(height-top-bottom);
  const series = [
    { key: 'baseline', name: 'Первоначальный', data: baseline, color: 'var(--studio-muted)', dash: '5 5', end: max },
    { key: 'current', name: 'Текущий', data: current, color: 'var(--studio-accent)', dash: '', end: max },
    { key: 'actual', name: 'Факт', data: actual, color: 'var(--studio-fact)', dash: '', end: now },
  ].filter(s => s.key === 'actual' || s.data.length > 0);
  function path(data: number[], end: number) {
    let d = `M ${x(min)} ${y(0)}`;
    data.forEach((date, index) => { d += ` H ${x(date)} V ${y(index+1)}`; });
    return d + ` H ${x(end)}`;
  }
  const tickCount = width < 420 ? 4 : 6;
  return <div className="studio-progress-chart" ref={ref}>
    <div className="studio-chart-legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} className={s.dash ? 'is-dashed' : ''}/>{s.name}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Движение курса: записано ${actual.length} из ${course.lessons.length}. Первоначальный план, текущий план и факт.`}>
      {[0, .25, .5, .75, 1].map(part => <g key={part}><line x1={left} x2={width-right} y1={y(maxCount*part)} y2={y(maxCount*part)} stroke="var(--studio-line)" strokeDasharray={part ? '2 5' : undefined}/><text x={left-9} y={y(maxCount*part)+4} textAnchor="end" className="studio-axis">{Math.round(maxCount*part)}</text></g>)}
      {Array.from({length:tickCount},(_,i) => { const date=min+(max-min)*i/(tickCount-1); return <text key={i} x={x(date)} y={height-13} textAnchor={i===0?'start':i===tickCount-1?'end':'middle'} className="studio-axis">{label(date)}</text>; })}
      <line x1={x(now)} x2={x(now)} y1={top} y2={height-bottom} stroke="var(--studio-line)"/>
      {series.map(s => <path key={s.key} d={path(s.data,s.end)} fill="none" stroke={s.color} strokeWidth={s.key==='actual'?3.5:2.3} strokeDasharray={s.dash} strokeLinejoin="round"/>)}
      <circle cx={x(now)} cy={y(actual.length)} r={5} fill="var(--studio-fact)" stroke="var(--studio-paper)" strokeWidth={2}/>
      <text x={Math.min(width-right-4,Math.max(left+22,x(now)))} y={top-7} textAnchor="middle" className="studio-axis studio-axis-today">сегодня</text>
    </svg>
  </div>;
}

export function ScheduleChart({ course, onOpenLesson }: { course: Course; onOpenLesson: (id: string) => void }) {
  const { ref, width } = useWidth();
  const lessons = [...course.lessons].sort((a,b) => a.order-b.order);
  const now = asTime(today(course.timezone));
  const dates = lessons.flatMap(l => [l.baselineDate,l.scheduledDate,l.recordedOn&&asTime(l.recordedOn)<=now?l.recordedOn:null,l.deliveryDeadline].filter(Boolean).map(d => asTime(d!))).filter(Number.isFinite);
  if (!lessons.length || !dates.length) return <div className="studio-chart-empty"><span className="studio-crosshair">＋</span><p>Расставь уроки по календарю</p><span>Даты можно назначить в карточках или через единое окно.</span></div>;
  const min = Math.min(...dates,now)-DAY, max = Math.max(...dates,now)+DAY;
  const left = width<520?65:190, right=22, top=44, row=50, bottom=42, height=top+lessons.length*row+bottom;
  const x=(date:number) => left+(date-min)/(max-min)*(width-left-right);
  const tickCount=width<420?3:6;
  return <div className="studio-schedule-chart" ref={ref}>
    <div className="studio-chart-legend"><span><i style={{background:'var(--studio-muted)'}} className="is-dashed"/>Первоначальный</span><span><i style={{background:'var(--studio-accent)'}}/>Текущий</span><span><i style={{background:'var(--studio-fact)'}}/>Факт записи</span><span><i className="studio-deadline-legend"/>Крайний срок сдачи</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="График записи и крайних сроков сдачи по урокам. Флаг обозначает крайний срок сдачи готового урока. Каждую строку можно открыть для редактирования.">
      {Array.from({length:tickCount},(_,i)=>{const time=min+(max-min)*i/(tickCount-1);return <g key={i}><line x1={x(time)} x2={x(time)} y1={top-12} y2={height-bottom} stroke="var(--studio-line)"/><text x={x(time)} y={22} textAnchor={i===0?'start':i===tickCount-1?'end':'middle'} className="studio-axis">{label(time)}</text></g>;})}
      <line x1={x(now)} x2={x(now)} y1={top-12} y2={height-bottom} stroke="var(--studio-fact)" strokeWidth={1} opacity={.6}/>
      {lessons.map((lesson,index)=>{
        const cy=top+index*row+row/2;
        const baseline=lesson.baselineDate?x(asTime(lesson.baselineDate)):null;
        const current=lesson.scheduledDate?x(asTime(lesson.scheduledDate)):null;
        const fact=lesson.recordedOn&&asTime(lesson.recordedOn)<=now?x(asTime(lesson.recordedOn)):null;
        const deadline=lesson.deliveryDeadline&&Number.isFinite(asTime(lesson.deliveryDeadline))?x(asTime(lesson.deliveryDeadline)):null;
        return <g key={lesson.id} role="button" tabIndex={0} className="studio-schedule-row" aria-label={`${lesson.code} ${lesson.title}, открыть урок`} onClick={()=>onOpenLesson(lesson.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpenLesson(lesson.id);}}}>
          <rect x={0} y={cy-row/2} width={width} height={row} fill="transparent"/>
          <line x1={0} x2={width} y1={cy+row/2} y2={cy+row/2} stroke="var(--studio-line)"/>
          <text x={2} y={cy+4} className="studio-code-axis">{lesson.code}</text>
          {width>=520&&<text x={49} y={cy+4} className="studio-axis">{lesson.title.length>20?lesson.title.slice(0,19)+'…':lesson.title}</text>}
          {baseline!==null&&current!==null&&baseline!==current&&<line x1={baseline} x2={current} y1={cy} y2={cy} stroke="var(--studio-line)" strokeWidth={2}/>}
          {baseline!==null&&<circle cx={baseline} cy={cy-8} r={4} fill="var(--studio-bg)" stroke="var(--studio-muted)" strokeWidth={2}><title>Первоначально: {lesson.baselineDate}</title></circle>}
          {current!==null&&<path d={`M ${current} ${cy-5} l 5 5 -5 5 -5 -5 Z`} fill="var(--studio-accent)"><title>Текущий план: {lesson.scheduledDate}</title></path>}
          {fact!==null&&<circle cx={fact} cy={cy+9} r={4.5} fill="var(--studio-fact)"><title>Записан: {lesson.recordedOn}</title></circle>}
          {deadline!==null&&<g className="studio-delivery-mark"><title>Крайний срок сдачи: {formatDeadline(lesson.deliveryDeadline!)} · {getDeliveryStatus(lesson,course.timezone).label}</title><line x1={deadline} x2={deadline} y1={cy-18} y2={cy+18} stroke="var(--studio-warn)" strokeWidth={1.5}/><path d={`M ${deadline} ${cy-18} h 9 l -3 4 3 4 h -9 Z`} fill="var(--studio-warn)"/></g>}
          {!lesson.scheduledDate&&!lesson.recordedOn&&<text x={left+8} y={cy+4} className="studio-axis">Дата пока не назначена</text>}
        </g>;
      })}
      <text x={width-right} y={height-10} textAnchor="end" className="studio-axis">Дата записи</text>
    </svg>
  </div>;
}

const formatDeadline=(date:string)=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(asTime(date)));
