export const DEFAULT_TZ = 'Africa/Windhoek';

export type Unit = 'EACH' | 'KG' | 'L' | 'PORTION' | 'PACK';
export const UNITS: Unit[] = ['EACH', 'KG', 'L', 'PORTION', 'PACK'];
export const UNIT_LABEL: Record<Unit, string> = { EACH: 'each', KG: 'kg', L: 'L', PORTION: 'portions', PACK: 'packs' };
export const isCounted = (u: string) => u === 'EACH' || u === 'PORTION' || u === 'PACK';

export function fmtQty(qty: number, unit: string): string {
  const n = isCounted(unit) ? String(Math.round(qty)) : (Math.round(qty * 1000) / 1000).toLocaleString('en-GB', { maximumFractionDigits: 3 });
  const label = UNIT_LABEL[unit as Unit] ?? unit.toLowerCase();
  return unit === 'EACH' ? n : `${n} ${label}`;
}

/** dd/MM/yyyy in the restaurant's zone. */
export function fmtDate(iso: string | Date, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

export function fmtDateTime(iso: string | Date, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** yyyy-mm-dd for <input type="date"> and the API, in the restaurant's zone. */
export function localDate(d: Date = new Date(), tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "today", "tomorrow", "in 3 days", "2 days ago" — relative to the local calendar. */
export function relativeDay(iso: string, tz = DEFAULT_TZ, now = new Date()): string {
  const a = localDate(new Date(iso), tz);
  const b = localDate(now, tz);
  const days = Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export const MOVEMENT_LABEL: Record<string, string> = {
  ADD: 'Put in',
  TAKE: 'Taken',
  WASTE: 'Wasted',
  ADJUST: 'Count correction',
  TRANSFER_OUT: 'Moved out',
  TRANSFER_IN: 'Moved in',
};

export const KIND_LABEL: Record<string, string> = {
  WALK_IN: 'Walk-in',
  REACH_IN: 'Reach-in',
  PREP: 'Prep',
  BAR: 'Bar',
  FREEZER: 'Freezer',
};
