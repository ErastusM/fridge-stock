/**
 * The reception fridge: one fridge, the people who take from it, and a log of every take.
 *
 * Everything here is pure (no storage, no clock unless passed in) so it can be tested on its own.
 * Money is whole cents. The log is append-only: a mistake is voided with a reason, never deleted,
 * and the price is copied onto each take, so a later price change never rewrites a past month.
 */

export interface Person {
  id: string;
  name: string;
  active: boolean;
}

export interface Item {
  id: string;
  name: string;
  /** Price per unit in cents, or null when the item is free (still recorded and counted). */
  priceCents: number | null;
  /** Units in the fridge. Can drop below zero when takes are recorded before a delivery is. */
  stock: number;
  /** Show "Low" at or below this many. 0 = never warn. */
  lowAt: number;
  active: boolean;
}

export type EntryKind = 'TAKE' | 'RESTOCK' | 'COUNT';

export interface Entry {
  id: string;
  /** When it happened (ISO). May be earlier than `recordedAt` when logged after the fact. */
  at: string;
  recordedAt: string;
  kind: EntryKind;
  itemId: string;
  /** TAKE/RESTOCK: units (> 0). COUNT: the change the count made (+/-). */
  qty: number;
  /** TAKE only. */
  personId?: string;
  /** TAKE only: the price at the time, frozen. */
  unitPriceCents?: number | null;
  note?: string;
  /** Takes saved together share a group, so "Erastus took 2 Coke + 1 Water" undoes as one. */
  groupId?: string;
  voided?: { at: string; reason: string };
}

export interface Settings {
  fridgeName: string;
  /** The report month starts on this day (1 = calendar month; 16 = 16th to 15th). 1-28. */
  monthStartDay: number;
  lastBackupAt?: string;
}

export interface Data {
  version: 1;
  settings: Settings;
  people: Person[];
  items: Item[];
  entries: Entry[];
}

export const emptyData = (): Data => ({
  version: 1,
  settings: { fridgeName: 'Reception fridge', monthStartDay: 1 },
  people: [],
  items: [],
  entries: [],
});

export class RuleError extends Error {}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ');

function requireWholePositive(n: number, what: string) {
  if (!Number.isInteger(n) || n <= 0) throw new RuleError(`${what} must be a whole number above 0.`);
}

// ---------- people ----------

export function addPerson(d: Data, name: string): Data {
  const n = cleanName(name);
  if (!n) throw new RuleError('Type a name.');
  if (d.people.some((p) => p.name.toLowerCase() === n.toLowerCase()))
    throw new RuleError(`${n} is already on the list.`);
  return { ...d, people: [...d.people, { id: newId(), name: n, active: true }] };
}

export function updatePerson(d: Data, id: string, patch: Partial<Pick<Person, 'name' | 'active'>>): Data {
  if (patch.name !== undefined) {
    const n = cleanName(patch.name);
    if (!n) throw new RuleError('Type a name.');
    if (d.people.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase()))
      throw new RuleError(`${n} is already on the list.`);
    patch = { ...patch, name: n };
  }
  return { ...d, people: d.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

// ---------- items ----------

export function addItem(d: Data, input: { name: string; priceCents: number | null; stock?: number; lowAt?: number }): Data {
  const n = cleanName(input.name);
  if (!n) throw new RuleError('Type the item name.');
  if (d.items.some((i) => i.name.toLowerCase() === n.toLowerCase()))
    throw new RuleError(`${n} is already in the fridge list.`);
  checkPrice(input.priceCents);
  const stock = input.stock ?? 0;
  if (!Number.isInteger(stock) || stock < 0) throw new RuleError('Starting stock must be 0 or more.');
  const item: Item = { id: newId(), name: n, priceCents: input.priceCents, stock, lowAt: input.lowAt ?? 0, active: true };
  return { ...d, items: [...d.items, item] };
}

export function updateItem(
  d: Data,
  id: string,
  patch: Partial<Pick<Item, 'name' | 'priceCents' | 'lowAt' | 'active'>>,
): Data {
  if (patch.name !== undefined) {
    const n = cleanName(patch.name);
    if (!n) throw new RuleError('Type the item name.');
    if (d.items.some((i) => i.id !== id && i.name.toLowerCase() === n.toLowerCase()))
      throw new RuleError(`${n} is already in the fridge list.`);
    patch = { ...patch, name: n };
  }
  if (patch.priceCents !== undefined) checkPrice(patch.priceCents);
  if (patch.lowAt !== undefined && (!Number.isInteger(patch.lowAt) || patch.lowAt < 0))
    throw new RuleError('The low-stock level must be 0 or more.');
  return { ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
}

function checkPrice(c: number | null) {
  if (c !== null && (!Number.isInteger(c) || c < 0)) throw new RuleError('The price must be 0 or more.');
}

// ---------- the log ----------

export interface TakeLine {
  itemId: string;
  qty: number;
}

/** "Erastus took 2 Coke and 1 Water" — one save, one group, stock goes down. */
export function recordTake(
  d: Data,
  input: { personId: string; lines: TakeLine[]; at: Date; now: Date; note?: string },
): { data: Data; groupId: string } {
  const person = d.people.find((p) => p.id === input.personId);
  if (!person) throw new RuleError('Choose who took it.');
  const lines = input.lines.filter((l) => l.qty !== 0);
  if (lines.length === 0) throw new RuleError('Choose at least one item.');
  if (input.at.getTime() > input.now.getTime() + 60_000) throw new RuleError('The time cannot be in the future.');
  const groupId = newId();
  const recordedAt = input.now.toISOString();
  const entries: Entry[] = [];
  const delta = new Map<string, number>();
  for (const l of lines) {
    requireWholePositive(l.qty, 'The quantity');
    const item = d.items.find((i) => i.id === l.itemId);
    if (!item) throw new RuleError('That item is no longer in the list.');
    entries.push({
      id: newId(),
      at: input.at.toISOString(),
      recordedAt,
      kind: 'TAKE',
      itemId: item.id,
      qty: l.qty,
      personId: person.id,
      unitPriceCents: item.priceCents,
      note: input.note?.trim() || undefined,
      groupId,
    });
    delta.set(item.id, (delta.get(item.id) ?? 0) - l.qty);
  }
  return { data: applyStock({ ...d, entries: [...d.entries, ...entries] }, delta), groupId };
}

export function recordRestock(d: Data, input: { itemId: string; qty: number; now: Date; note?: string }): Data {
  requireWholePositive(input.qty, 'The quantity');
  if (!d.items.some((i) => i.id === input.itemId)) throw new RuleError('That item is no longer in the list.');
  const t = input.now.toISOString();
  const e: Entry = { id: newId(), at: t, recordedAt: t, kind: 'RESTOCK', itemId: input.itemId, qty: input.qty, note: input.note?.trim() || undefined };
  return applyStock({ ...d, entries: [...d.entries, e] }, new Map([[input.itemId, input.qty]]));
}

/** A fridge count: set the stock to what is really there; the difference is logged with a reason. */
export function recordCount(d: Data, input: { itemId: string; counted: number; now: Date; note?: string }): Data {
  if (!Number.isInteger(input.counted) || input.counted < 0) throw new RuleError('The count must be 0 or more.');
  const item = d.items.find((i) => i.id === input.itemId);
  if (!item) throw new RuleError('That item is no longer in the list.');
  const change = input.counted - item.stock;
  if (change === 0) return d;
  const t = input.now.toISOString();
  const e: Entry = { id: newId(), at: t, recordedAt: t, kind: 'COUNT', itemId: item.id, qty: change, note: input.note?.trim() || undefined };
  return applyStock({ ...d, entries: [...d.entries, e] }, new Map([[item.id, change]]));
}

/** Void a mistaken entry (or its whole group). It stays in the log, struck through; stock is put back. */
export function voidEntry(d: Data, input: { entryId: string; reason: string; now: Date; wholeGroup?: boolean }): Data {
  const reason = input.reason.trim();
  if (!reason) throw new RuleError('Say why it is being undone.');
  const target = d.entries.find((e) => e.id === input.entryId);
  if (!target) throw new RuleError('That entry no longer exists.');
  if (target.voided) throw new RuleError('That entry is already undone.');
  const hit = (e: Entry) =>
    !e.voided && (e.id === target.id || (input.wholeGroup && target.groupId !== undefined && e.groupId === target.groupId));
  const delta = new Map<string, number>();
  const at = input.now.toISOString();
  const entries = d.entries.map((e) => {
    if (!hit(e)) return e;
    delta.set(e.itemId, (delta.get(e.itemId) ?? 0) - stockEffect(e));
    return { ...e, voided: { at, reason } };
  });
  return applyStock({ ...d, entries }, delta);
}

export function stockEffect(e: Entry): number {
  if (e.kind === 'TAKE') return -e.qty;
  return e.qty;
}

function applyStock(d: Data, delta: Map<string, number>): Data {
  return { ...d, items: d.items.map((i) => (delta.has(i.id) ? { ...i, stock: i.stock + delta.get(i.id)! } : i)) };
}

export const amountOf = (e: Entry) => (e.kind === 'TAKE' && e.unitPriceCents ? e.unitPriceCents * e.qty : 0);

export type StockState = 'OK' | 'LOW' | 'OUT';
export function stockState(i: Item): StockState {
  if (i.stock <= 0) return 'OUT';
  if (i.lowAt > 0 && i.stock <= i.lowAt) return 'LOW';
  return 'OK';
}

// ---------- months & the report ----------

export interface Period {
  /** Key of the month the period is named after, e.g. "2026-11". */
  key: string;
  start: Date;
  /** Exclusive. */
  end: Date;
}

/**
 * The report month named `key` (YYYY-MM). With startDay 1 it is the calendar month; with 16 the
 * November report runs 16 October to 15 November (named after the month it ends in).
 * Local time: the device at reception is on Namibian time.
 */
export function periodFor(key: string, startDay: number): Period {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new RuleError('Bad month.');
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (startDay <= 1) return { key, start: new Date(y, mo, 1), end: new Date(y, mo + 1, 1) };
  return { key, start: new Date(y, mo - 1, startDay), end: new Date(y, mo, startDay) };
}

export function periodKeyOf(date: Date, startDay: number): string {
  let y = date.getFullYear();
  let mo = date.getMonth();
  if (startDay > 1 && date.getDate() >= startDay) {
    mo += 1;
    if (mo === 12) {
      mo = 0;
      y += 1;
    }
  }
  return `${y}-${String(mo + 1).padStart(2, '0')}`;
}

export function shiftKey(key: string, months: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface ReportLine {
  itemId: string;
  itemName: string;
  qty: number;
  amountCents: number;
}
export interface PersonReport {
  personId: string;
  name: string;
  lines: ReportLine[];
  qty: number;
  amountCents: number;
  takes: Entry[];
}
export interface MonthReport {
  period: Period;
  people: PersonReport[];
  items: ReportLine[];
  qty: number;
  amountCents: number;
}

export function monthReport(d: Data, key: string): MonthReport {
  const period = periodFor(key, d.settings.monthStartDay);
  const s = period.start.getTime();
  const e = period.end.getTime();
  const takes = d.entries
    .filter((x) => x.kind === 'TAKE' && !x.voided)
    .filter((x) => {
      const t = new Date(x.at).getTime();
      return t >= s && t < e;
    })
    .sort((a, b) => a.at.localeCompare(b.at));
  const itemName = (id: string) => d.items.find((i) => i.id === id)?.name ?? 'Removed item';
  const personName = (id: string) => d.people.find((p) => p.id === id)?.name ?? 'Removed person';

  const byPerson = new Map<string, PersonReport>();
  const byItem = new Map<string, ReportLine>();
  for (const t of takes) {
    const pid = t.personId!;
    let pr = byPerson.get(pid);
    if (!pr) {
      pr = { personId: pid, name: personName(pid), lines: [], qty: 0, amountCents: 0, takes: [] };
      byPerson.set(pid, pr);
    }
    const amt = amountOf(t);
    let line = pr.lines.find((l) => l.itemId === t.itemId);
    if (!line) {
      line = { itemId: t.itemId, itemName: itemName(t.itemId), qty: 0, amountCents: 0 };
      pr.lines.push(line);
    }
    line.qty += t.qty;
    line.amountCents += amt;
    pr.qty += t.qty;
    pr.amountCents += amt;
    pr.takes.push(t);

    const il = byItem.get(t.itemId) ?? { itemId: t.itemId, itemName: itemName(t.itemId), qty: 0, amountCents: 0 };
    il.qty += t.qty;
    il.amountCents += amt;
    byItem.set(t.itemId, il);
  }
  const people = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of people) p.lines.sort((a, b) => b.qty - a.qty || a.itemName.localeCompare(b.itemName));
  const items = [...byItem.values()].sort((a, b) => b.qty - a.qty || a.itemName.localeCompare(b.itemName));
  return {
    period,
    people,
    items,
    qty: people.reduce((n, p) => n + p.qty, 0),
    amountCents: people.reduce((n, p) => n + p.amountCents, 0),
  };
}

// ---------- formatting & CSV ----------

export function formatMoney(cents: number): string {
  const neg = cents < 0;
  const v = Math.abs(cents);
  const whole = Math.floor(v / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}N$ ${whole}.${String(v % 100).padStart(2, '0')}`;
}

/** "15", "15.5", "N$ 1 250,00" → cents. Empty → null. */
export function parseMoney(s: string): number | null {
  const t = s.replace(/N\$/i, '').replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new RuleError('Type the price like 15 or 15.50.');
  const [w, f = ''] = t.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
export const fmtDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export const fmtTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtDateTime = (d: Date) => `${fmtDate(d)} ${fmtTime(d)}`;

export function periodLabel(p: Period): string {
  const [y, m] = p.key.split('-').map(Number);
  const name = `${MONTHS[m - 1]} ${y}`;
  if (p.start.getDate() === 1) return name;
  const last = new Date(p.end.getTime() - 86_400_000);
  return `${name} (${fmtDate(p.start)} – ${fmtDate(last)})`;
}

function csvCell(v: string | number): string {
  let s = String(v);
  // A cell starting with = + - @ would run as a formula in Excel.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const money = (c: number) => (c / 100).toFixed(2);

export function reportCsv(r: MonthReport): string {
  const rows: (string | number)[][] = [['Person', 'Item', 'Quantity', 'Amount (N$)']];
  for (const p of r.people) {
    for (const l of p.lines) rows.push([p.name, l.itemName, l.qty, money(l.amountCents)]);
    rows.push([p.name, 'TOTAL', p.qty, money(p.amountCents)]);
  }
  rows.push(['ALL', 'TOTAL', r.qty, money(r.amountCents)]);
  return toCsv(rows);
}

export function takesCsv(d: Data, r: MonthReport): string {
  const item = (id: string) => d.items.find((i) => i.id === id)?.name ?? 'Removed item';
  const rows: (string | number)[][] = [['Date', 'Time', 'Person', 'Item', 'Quantity', 'Unit price (N$)', 'Amount (N$)', 'Note']];
  const all = r.people.flatMap((p) => p.takes.map((t) => ({ p, t }))).sort((a, b) => a.t.at.localeCompare(b.t.at));
  for (const { p, t } of all) {
    const at = new Date(t.at);
    rows.push([fmtDate(at), fmtTime(at), p.name, item(t.itemId), t.qty, t.unitPriceCents ? money(t.unitPriceCents) : '', money(amountOf(t)), t.note ?? '']);
  }
  return toCsv(rows);
}

// ---------- loading a saved copy ----------

/** Accept only something shaped like our data; a wrong file must not wipe the fridge. */
export function parseData(raw: unknown): Data {
  const bad = () => new RuleError('This is not a fridge backup file.');
  if (!raw || typeof raw !== 'object') throw bad();
  const d = raw as Partial<Data>;
  if (d.version !== 1 || !d.settings || !Array.isArray(d.people) || !Array.isArray(d.items) || !Array.isArray(d.entries)) throw bad();
  for (const p of d.people) if (typeof p?.id !== 'string' || typeof p?.name !== 'string') throw bad();
  for (const i of d.items) if (typeof i?.id !== 'string' || typeof i?.name !== 'string' || typeof i?.stock !== 'number') throw bad();
  for (const e of d.entries) if (typeof e?.id !== 'string' || typeof e?.at !== 'string' || typeof e?.qty !== 'number') throw bad();
  const day = Number(d.settings.monthStartDay);
  return {
    version: 1,
    settings: {
      fridgeName: String(d.settings.fridgeName || 'Reception fridge'),
      monthStartDay: Number.isInteger(day) && day >= 1 && day <= 28 ? day : 1,
      lastBackupAt: d.settings.lastBackupAt,
    },
    people: d.people.map((p) => ({ id: p.id, name: p.name, active: p.active !== false })),
    items: d.items.map((i) => ({
      id: i.id,
      name: i.name,
      priceCents: typeof i.priceCents === 'number' ? i.priceCents : null,
      stock: i.stock,
      lowAt: typeof i.lowAt === 'number' ? i.lowAt : 0,
      active: i.active !== false,
    })),
    entries: d.entries as Entry[],
  };
}

/** A few names and drinks to try the screens with. */
export function sampleData(now: Date): Data {
  let d = emptyData();
  for (const n of ['Erastus', 'Maria', 'Johannes', 'Selma', 'Petrus']) d = addPerson(d, n);
  const items: [string, number | null, number, number][] = [
    ['Coke 330ml', 1500, 24, 6],
    ['Coke Zero 330ml', 1500, 18, 6],
    ['Fanta Orange 330ml', 1500, 12, 6],
    ['Still water 500ml', 1000, 30, 8],
    ['Sparkling water 500ml', 1000, 12, 4],
    ['Red Bull 250ml', 3000, 8, 3],
    ['Appletiser 330ml', 1800, 10, 4],
    ['Yoghurt', 1200, 6, 2],
    ['Milk 1L (office)', null, 4, 1],
  ];
  for (const [name, price, stock, low] of items) d = addItem(d, { name, priceCents: price, stock, lowAt: low });
  const pick = (n: string) => d.items.find((i) => i.name === n)!.id;
  const who = (n: string) => d.people.find((p) => p.name === n)!.id;
  const takes: [number, string, string, number][] = [
    [12, 'Erastus', 'Coke 330ml', 2],
    [11, 'Maria', 'Still water 500ml', 1],
    [9, 'Johannes', 'Red Bull 250ml', 1],
    [8, 'Erastus', 'Still water 500ml', 1],
    [6, 'Selma', 'Coke Zero 330ml', 1],
    [5, 'Petrus', 'Fanta Orange 330ml', 2],
    [3, 'Maria', 'Yoghurt', 1],
    [2, 'Erastus', 'Coke 330ml', 1],
    [1, 'Johannes', 'Appletiser 330ml', 1],
  ];
  for (const [daysAgo, p, i, q] of takes) {
    const at = new Date(now.getTime() - daysAgo * 86_400_000);
    at.setHours(10 + (daysAgo % 6), 15, 0, 0);
    d = recordTake(d, { personId: who(p), lines: [{ itemId: pick(i), qty: q }], at, now }).data;
  }
  return d;
}
