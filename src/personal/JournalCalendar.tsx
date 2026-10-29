import { useRef } from 'react';
import { Icon } from '../components/Icon';
import { cx } from '../utils';
import { monthDays, shiftMonth } from './calendarDates';
import s from './Personal.module.css';
export function JournalCalendar({
  month,
  day,
  today,
  counts,
  onMonth,
  onDay,
  disabled = false,
}: {
  month: string;
  day: string;
  today: string;
  counts: Map<string, number>;
  onMonth: (month: string) => void;
  onDay: (day: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const days = monthDays(month);
  const monthCount = [...counts]
    .filter(([date]) => date.startsWith(month))
    .reduce((sum, [, count]) => sum + count, 0);
  return (
    <section data-journal-keyboard-local className={s.calendar} aria-label="开发记录日历">
      <div className={s.calendarHead}>
        <strong>
          {Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月
        </strong>
        <div>
          <button disabled={disabled} aria-label="上个月" onClick={() => onMonth(shiftMonth(month, -1))}>
            <Icon name="chevronLeft" size={16} />
          </button>
          <button
            disabled={disabled}
            className={s.todayButton}
            onClick={() => {
              onMonth(today.slice(0, 7));
              onDay(today);
            }}
          >
            今天
          </button>
          <button disabled={disabled} aria-label="下个月" onClick={() => onMonth(shiftMonth(month, 1))}>
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      </div>
      <div className={s.calendarWeek}>
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className={s.calendarGrid} ref={ref}>
        {days.map((date) => {
          const count = counts.get(date) || 0;
          return (
            <button
              key={date}
              data-date={date}
              disabled={disabled}
              className={cx(
                s.calendarDay,
                !date.startsWith(month) && s.otherMonth,
                date === today && s.calendarToday,
                date === day && s.selectedDay,
              )}
              aria-label={`${date}，${count} 条记录`}
              aria-pressed={date === day}
              title={`${date} · ${count} 条记录`}
              onClick={() => {
                if (!date.startsWith(month)) onMonth(date.slice(0, 7));
                onDay(date);
              }}
              onKeyDown={(event) => {
                const offsets: Record<string, number> = {
                  ArrowLeft: -1,
                  ArrowRight: 1,
                  ArrowUp: -7,
                  ArrowDown: 7,
                };
                const delta = offsets[event.key];
                if (!delta) return;
                event.preventDefault();
                const index = days.indexOf(date);
                const next = days[index + delta];
                if (next) ref.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus();
              }}
            >
              <span>{Number(date.slice(-2))}</span>
              <span className={s.dayDots} aria-hidden="true">
                {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className={s.calendarFoot}>
        <span>本月 {monthCount} 条记录</span>
        <button disabled={disabled || !day} onClick={() => onDay('')}>
          查看全部
        </button>
      </div>
    </section>
  );
}
