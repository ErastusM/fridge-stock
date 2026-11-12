/**
 * Local-time helpers without a date library. "Today" and use-by dates are the
 * restaurant's local calendar (Africa/Windhoek for Swakopmund), never UTC.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minutes the zone is ahead of UTC at that instant. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** The instant at which the wall clock in `tz` shows the given local time. */
export function localToUtc(y: number, m: number, d: number, hh: number, mi: number, ss: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mi, ss);
  const off = tzOffsetMinutes(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

/** yyyy-mm-dd of the instant, in the zone. */
export function localDateString(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function parseDateString(s: string): { y: number; m: number; d: number } | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function addDays(dateStr: string, n: number): string {
  const p = parseDateString(dateStr);
  if (!p) throw new Error(`invalid date ${dateStr}`);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return t.toISOString().slice(0, 10);
}

export function startOfLocalDay(dateStr: string, tz: string): Date {
  const p = parseDateString(dateStr);
  if (!p) throw new Error(`invalid date ${dateStr}`);
  return localToUtc(p.y, p.m, p.d, 0, 0, 0, tz);
}

/** A use-by date means "good until the end of that local day". */
export function endOfLocalDay(dateStr: string, tz: string): Date {
  const p = parseDateString(dateStr);
  if (!p) throw new Error(`invalid date ${dateStr}`);
  return localToUtc(p.y, p.m, p.d, 23, 59, 59, tz);
}

export function defaultExpiry(now: Date, shelfLifeDays: number, tz: string): Date {
  return endOfLocalDay(addDays(localDateString(now, tz), shelfLifeDays), tz);
}
