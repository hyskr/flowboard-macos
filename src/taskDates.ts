import type { Card, Column } from './types';
import { daysUntilDue, DUE_SOON_DAYS } from './utils.ts';

const returnPrefix = '完成前栏目：';
export const isScheduleTag = (tag: string) => /^安排日期：\d{4}-\d{2}-\d{2}$/.test(tag);
export const calendarStart = (tags: string[]) => tags.find(isScheduleTag)?.slice('安排日期：'.length) ?? '';
export function withCalendarStart(tags: string[], start: string) {
  const rest = tags.filter(tag => !isScheduleTag(tag));
  return start ? [...rest, '安排日期：' + start] : rest;
}
export const isReturnTag = (tag: string) => tag.startsWith(returnPrefix);
export function rememberColumn(tags: string[], id: string | null) {
  return [...tags.filter(tag => !isReturnTag(tag)), returnPrefix + (id ?? '')];
}
export const previousColumn = (tags: string[]) => tags.find(isReturnTag)?.slice(returnPrefix.length);
export const doneColumn = (columns: Column[]) => columns.find(col => col.name === '已完成') ?? columns.find(col => col.name === '已交付');
export const dateKey = (date: Date) => [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

export function calendarTasksByDay(cards: Card[], visibleDays: string[]) {
  const byDay = new Map<string, Card[]>();
  const sorted = cards.filter(card => !card.completedAt).sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high')
    || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.order - b.order);
  for (const card of sorted) {
    const selected = calendarStart(card.tags);
    const end = card.dueDate || selected;
    if (!end) continue;
    const start = selected && selected < end ? selected : end;
    for (const day of visibleDays) {
      if (day < start || day > end) continue;
      const tasks = byDay.get(day);
      if (tasks) tasks.push(card);
      else byDay.set(day, [card]);
    }
  }
  // Surface deadlines before ongoing work when a day has room for only a few titles.
  for (const [day, tasks] of byDay) tasks.sort((a, b) => Number(b.dueDate === day) - Number(a.dueDate === day));
  return byDay;
}

export function calendarMark(due: string | null, cellDay: string, today: Date) {
  const deadline = due === cellDay;
  const dayLabel = deadline ? '截止日' : '安排日';
  if (!due) return { deadline, tone: 'ordinary', dayLabel, timing: '' } as const;
  const days = daysUntilDue(due, today);
  if (days < 0) return { deadline, tone: 'pastDue', dayLabel, timing: `已逾期 ${-days} 天` } as const;
  if (days === 0) return { deadline, tone: 'dueToday', dayLabel, timing: '今天截止' } as const;
  if (days <= DUE_SOON_DAYS) return { deadline, tone: 'dueSoon', dayLabel, timing: days === 1 ? '明天截止' : `${days} 天后截止` } as const;
  return { deadline, tone: deadline ? 'deadline' : 'ordinary', dayLabel, timing: '' } as const;
}
