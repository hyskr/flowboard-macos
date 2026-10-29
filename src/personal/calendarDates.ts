export function dateKey(year: number, month: number, day: number) {
  const date = new Date(year, month, day, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function monthDays(month: string) {
  const [year, oneBasedMonth] = month.split('-').map(Number);
  const index = oneBasedMonth - 1;
  const offset = (new Date(year, index, 1, 12).getDay() + 6) % 7;
  const length = new Date(year, index + 1, 0, 12).getDate();
  return Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, i) =>
    dateKey(year, index, i - offset + 1),
  );
}
export function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split('-').map(Number);
  return dateKey(year, value - 1 + delta, 1).slice(0, 7);
}
export function todayInZone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
