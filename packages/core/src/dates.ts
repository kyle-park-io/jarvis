const DAY_MS = 86_400_000;

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso: string): number {
  return parseISODate(iso).getUTCDay();
}

export function weekStart(iso: string): string {
  const d = parseISODate(iso);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Mon->0 ... Sun->6
  return toISODate(new Date(d.getTime() - daysSinceMonday * DAY_MS));
}

export function isSameWeek(a: string, b: string): boolean {
  return weekStart(a) === weekStart(b);
}

export function daysUntil(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / DAY_MS);
}

export function countRemainingWorkdays(iso: string, workdays: number[]): number {
  const start = parseISODate(iso);
  const daysToSunday = (7 - start.getUTCDay()) % 7; // Sun->0, Mon->6, Sat->1
  let count = 0;
  for (let i = 0; i <= daysToSunday; i++) {
    const day = new Date(start.getTime() + i * DAY_MS).getUTCDay();
    if (workdays.includes(day)) count++;
  }
  return count;
}

export function workdaysInWeek(iso: string, workdays: number[]): number {
  const monday = parseISODate(weekStart(iso));
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday.getTime() + i * DAY_MS).getUTCDay();
    if (workdays.includes(day)) count++;
  }
  return count;
}

export function workdaysElapsed(iso: string, workdays: number[]): number {
  const monday = parseISODate(weekStart(iso));
  const today = parseISODate(iso);
  let count = 0;
  for (let t = monday.getTime(); t <= today.getTime(); t += DAY_MS) {
    if (workdays.includes(new Date(t).getUTCDay())) count++;
  }
  return count;
}
