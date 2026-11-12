/**
 * Money is integer cents everywhere (N$13.00 = 1300) — floats never hold a balance.
 * Statement periods are local calendar days, inclusive at both ends.
 */
import { addDays, parseDateString } from './time';

export const CURRENCY = 'N$';

export function formatCents(c: number): string {
  const sign = c < 0 ? '-' : '';
  const a = Math.abs(Math.round(c));
  return `${sign}${CURRENCY}${Math.floor(a / 100).toLocaleString('en-GB')}.${String(a % 100).padStart(2, '0')}`;
}

/** What a take costs: quantity × unit price, rounded half-up to the cent. */
export function chargeFor(qty: number, unitPriceCents: number): number {
  return Math.round(qty * unitPriceCents + 1e-9);
}

/** "13.50" / "13,50" / "13" → 1350. Null for anything that is not a non-negative amount with ≤ 2 decimals. */
export function parseMoney(s: string): number | null {
  const t = s.trim().replace(/^N\$\s*/i, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The statement period that ENDS in the given month. With startDay 16, "2026-11" is
 * 16 Oct 2026 – 15 Nov 2026. With startDay 1 it is the calendar month.
 */
export function statementPeriod(month: string, startDay: number): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`invalid month ${month}`);
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) throw new Error(`invalid month ${month}`);
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) throw new Error('startDay must be 1..28');
  if (startDay === 1) return { from: `${y}-${pad(mo)}-01`, to: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` };
  const py = mo === 1 ? y - 1 : y;
  const pm = mo === 1 ? 12 : mo - 1;
  return { from: `${py}-${pad(pm)}-${pad(startDay)}`, to: `${y}-${pad(mo)}-${pad(startDay - 1)}` };
}

/** The month (yyyy-mm) whose statement period contains this local day. */
export function periodMonthFor(day: string, startDay: number): string {
  const p = parseDateString(day);
  if (!p) throw new Error(`invalid date ${day}`);
  if (startDay > 1 && p.d >= startDay) {
    const ny = p.m === 12 ? p.y + 1 : p.y;
    const nm = p.m === 12 ? 1 : p.m + 1;
    return `${ny}-${pad(nm)}`;
  }
  return `${p.y}-${pad(p.m)}`;
}

export interface ChargeLine {
  /** local yyyy-mm-dd */
  date: string;
  amountCents: number;
}
export interface PaymentLine {
  date: string;
  amountCents: number;
}

/**
 * Opening balance = everything charged before the period minus everything paid before it;
 * closing = opening + charges in the period − payments in the period. Positive = owed.
 */
export function statementTotals(charges: ChargeLine[], payments: PaymentLine[], from: string, to: string) {
  const before = (d: string) => d < from;
  const inside = (d: string) => d >= from && d <= to;
  const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);
  const opening = sum(charges.filter((c) => before(c.date))) - sum(payments.filter((p) => before(p.date)));
  const purchases = sum(charges.filter((c) => inside(c.date)));
  const paid = sum(payments.filter((p) => inside(p.date)));
  return { openingCents: opening, purchasesCents: purchases, paidCents: paid, closingCents: opening + purchases - paid };
}

/** Balance as of a local day (inclusive). */
export function balanceAt(charges: ChargeLine[], payments: PaymentLine[], day: string): number {
  return statementTotals(charges, payments, addDays(day, 1), addDays(day, 1)).openingCents;
}
