/**
 * DEMO BUILD ONLY (VITE_DEMO=1): a stand-in for the API that runs inside the browser, so the app
 * can be tried on a phone from a static host (GitHub Pages) with no server. State lives in this
 * browser's localStorage; nothing is shared between devices.
 *
 * It reuses the real server's pure rules — FIFO consumption, stock and expiry status, local-day
 * maths, quantity checks, CSV — so the demo behaves like the real thing. It does NOT reproduce the
 * server's security (PINs are stored in plain text here, there are no passwords): it is a demo.
 */
import { consumeFifo, fifoOrder, round3, totalQty } from '../../../server/src/domain/fifo';
import { expiryStatus, stockStatus, worstExpiry } from '../../../server/src/domain/status';
import { addDays, defaultExpiry, endOfLocalDay, localDateString, parseDateString, startOfLocalDay } from '../../../server/src/domain/time';
import { quantityError, UnitName } from '../../../server/src/domain/quantity';
import { toCsv } from '../../../server/src/domain/csv';
import { chargeFor, formatCents, periodMonthFor, statementPeriod, statementTotals } from '../../../server/src/domain/money';

export class DemoHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
const fail = (status: number, msg: string, details?: unknown): never => {
  throw new DemoHttpError(status, msg, details);
};

type Role = 'STAFF' | 'MANAGER' | 'OWNER';
interface Restaurant { id: string; name: string; timezone: string; statementStartDay: number; active: boolean; createdAt: string }
interface Fridge { id: string; restaurantId: string; name: string; kind: string; active: boolean; createdAt: string }
interface Item { id: string; restaurantId: string; name: string; category: string; unit: UnitName; defaultShelfLifeDays: number; priceCents: number | null; active: boolean; createdAt: string }
interface FridgeItem { id: string; fridgeId: string; itemId: string; minQty: number; parLevel: number }
interface Batch { id: string; fridgeId: string; itemId: string; qtyRemaining: number; expiresAt: string; receivedAt: string }
interface Movement { id: string; fridgeId: string; itemId: string; type: string; qty: number; qtyAfter: number; staffId: string; deviceId: string | null; reason: string | null; expiresAt: string | null; transferGroup: string | null; clientId: string | null; unitPriceCents: number | null; amountCents: number | null; supplier: string | null; recordedById: string | null; createdAt: string }
interface Payment { id: string; restaurantId: string; staffId: string; amountCents: number; method: string; paidOn: string; reference: string | null; recordedById: string; voidedAt: string | null; voidReason: string | null; createdAt: string }
interface Staff { id: string; restaurantId: string | null; name: string; role: Role; pin: string; email: string | null; active: boolean }
interface Device { id: string; fridgeId: string; name: string; failed: number; lockedUntil: string | null; lastSeenAt: string | null; revokedAt: string | null; createdAt: string }
interface Pairing { code: string; fridgeId: string; deviceName: string; expiresAt: string; used: boolean }
interface State { v: number; restaurants: Restaurant[]; fridges: Fridge[]; items: Item[]; fridgeItems: FridgeItem[]; batches: Batch[]; movements: Movement[]; staff: Staff[]; devices: Device[]; pairings: Pairing[]; payments: Payment[] }

const KEY = 'fs.demoState';
const VERSION = 2;
const TZ = 'Africa/Windhoek';
const EXPIRING_HOURS = 48;
let seq = 0;
const id = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const iso = (d: Date) => d.toISOString();

// ---------------------------------------------------------------- seed

const ITEMS: [string, string, UnitName, number][] = [
  ['Kingklip fillet', 'Seafood', 'KG', 2],
  ['Calamari tubes', 'Seafood', 'KG', 2],
  ['Walvis Bay oysters', 'Seafood', 'EACH', 3],
  ['Prawns (shell-on)', 'Seafood', 'KG', 2],
  ['Beef fillet', 'Meat', 'KG', 4],
  ['Chicken breast', 'Meat', 'KG', 3],
  ['Oryx loin', 'Meat', 'KG', 4],
  ['Full-cream milk', 'Dairy', 'L', 5],
  ['Fresh cream', 'Dairy', 'L', 7],
  ['Butter (500 g)', 'Dairy', 'PACK', 30],
  ['Cheddar', 'Dairy', 'KG', 21],
  ['Eggs', 'Dairy', 'EACH', 21],
  ['Lettuce', 'Produce', 'EACH', 4],
  ['Tomatoes', 'Produce', 'KG', 5],
  ['Lemons', 'Produce', 'EACH', 14],
  ['Garlic aioli', 'Prep', 'L', 3],
  ['Windhoek Lager 440 ml', 'Drinks', 'EACH', 180],
  ['Savanna Dry 330 ml', 'Drinks', 'EACH', 180],
  ['Soda water 200 ml', 'Drinks', 'EACH', 365],
  ['Orange juice', 'Drinks', 'L', 7],
];
const OFFICE_ITEMS: [string, string, UnitName, number, number][] = [
  ['Coke 300 ml', 'Drinks', 'EACH', 180, 1300],
  ['Coke Zero 300 ml', 'Drinks', 'EACH', 180, 1200],
  ['Sprite 300 ml', 'Drinks', 'EACH', 180, 1200],
  ['Monster 500 ml', 'Drinks', 'EACH', 365, 2500],
  ['Exotic juice 300 ml', 'Drinks', 'EACH', 90, 1300],
  ['Still water 500 ml', 'Drinks', 'EACH', 365, 800],
  ['Sparkling water 500 ml', 'Drinks', 'EACH', 365, 800],
];
const VENUES: { name: string; office?: boolean; fridges: [string, string, string[]][] }[] = [
  { name: 'Lighthouse Venue A (demo)', fridges: [['Walk-in cooler', 'WALK_IN', ['Seafood', 'Meat', 'Dairy', 'Produce']], ['Prep fridge', 'PREP', ['Prep', 'Produce', 'Dairy']], ['Bar fridge', 'BAR', ['Drinks']]] },
  { name: 'Lighthouse Venue B (demo)', fridges: [['Walk-in cooler', 'WALK_IN', ['Seafood', 'Meat', 'Dairy', 'Produce', 'Prep']], ['Bar fridge', 'BAR', ['Drinks']]] },
  { name: 'Lighthouse Head Office (demo)', office: true, fridges: [['Office fridge', 'REACH_IN', ['Drinks']]] },
];

/** The demo cast, shown on screen so a tester can sign in and use PINs. */
export const DEMO_PEOPLE = [
  { name: 'Group Owner', role: 'OWNER' as Role, venue: null as number | null, pin: '9999', email: 'owner@demo' },
  { name: 'Manager A', role: 'MANAGER' as Role, venue: 0, pin: '1000', email: 'manager.a@demo' },
  { name: 'Anna', role: 'STAFF' as Role, venue: 0, pin: '1111', email: null },
  { name: 'Johannes', role: 'STAFF' as Role, venue: 0, pin: '2222', email: null },
  { name: 'Selma', role: 'STAFF' as Role, venue: 0, pin: '3333', email: null },
  { name: 'Manager B', role: 'MANAGER' as Role, venue: 1, pin: '2000', email: 'manager.b@demo' },
  { name: 'Petrus', role: 'STAFF' as Role, venue: 1, pin: '4444', email: null },
  { name: 'Ndapewa', role: 'STAFF' as Role, venue: 1, pin: '5555', email: null },
  { name: 'Office Manager', role: 'MANAGER' as Role, venue: 2, pin: '3000', email: 'office@demo' },
  { name: 'Maria', role: 'STAFF' as Role, venue: 2, pin: '6666', email: null },
  { name: 'Tjeripo', role: 'STAFF' as Role, venue: 2, pin: '7777', email: null },
  { name: 'Hilma', role: 'STAFF' as Role, venue: 2, pin: '8888', email: null },
];

function seed(): State {
  const now = new Date();
  const today = localDateString(now, TZ);
  const s: State = { v: VERSION, restaurants: [], fridges: [], items: [], fridgeItems: [], batches: [], movements: [], staff: [], devices: [], pairings: [], payments: [] };
  const restIds: string[] = [];
  for (const v of VENUES) {
    const r: Restaurant = { id: id('r'), name: v.name, timezone: TZ, statementStartDay: 16, active: true, createdAt: iso(now) };
    s.restaurants.push(r);
    restIds.push(r.id);
  }
  for (const p of DEMO_PEOPLE) {
    s.staff.push({ id: id('s'), restaurantId: p.venue === null ? null : restIds[p.venue], name: p.name, role: p.role, pin: p.pin, email: p.email, active: true });
  }
  VENUES.forEach((v, vi) => {
    const rid = restIds[vi];
    const venueStaff = s.staff.filter((x) => x.restaurantId === rid && x.role === 'STAFF');
    const catalogue: [string, string, UnitName, number, number | null][] = v.office ? OFFICE_ITEMS : ITEMS.map(([a, b, c, d]) => [a, b, c, d, null]);
    const items = catalogue.map(([name, category, unit, shelf, priceCents]) => {
      const it: Item = { id: id('i'), restaurantId: rid, name, category, unit, defaultShelfLifeDays: shelf, priceCents, active: true, createdAt: iso(now) };
      s.items.push(it);
      return it;
    });
    let k = 0;
    for (const [fname, kind, cats] of v.fridges) {
      const f: Fridge = { id: id('f'), restaurantId: rid, name: fname, kind, active: true, createdAt: iso(now) };
      s.fridges.push(f);
      for (const it of items) {
        if (!cats.includes(it.category)) continue;
        const counted = it.unit !== 'KG' && it.unit !== 'L';
        const drinks = it.category === 'Drinks';
        const par = drinks ? (counted ? 48 : 12) : counted ? 24 : 6;
        const min = drinks ? (counted ? 12 : 3) : counted ? 6 : 1.5;
        s.fridgeItems.push({ id: id('fi'), fridgeId: f.id, itemId: it.id, minQty: min, parLevel: par });
        k++;
        const scenario = k % 7;
        if (scenario === 3) continue; // out of stock
        const qty = scenario === 2 ? (counted ? Math.max(1, Math.floor(min / 2)) : 1) : counted ? Math.round(par * 0.8) : 4.5;
        const expiresAt =
          scenario === 4 ? endOfLocalDay(addDays(today, 1), TZ) : scenario === 5 ? endOfLocalDay(addDays(today, -1), TZ) : defaultExpiry(now, it.defaultShelfLifeDays, TZ);
        const received = iso(new Date(now.getTime() - 26 * 3600_000));
        s.batches.push({ id: id('b'), fridgeId: f.id, itemId: it.id, qtyRemaining: qty, expiresAt: iso(expiresAt), receivedAt: received });
        s.movements.push({
          id: id('m'), fridgeId: f.id, itemId: it.id, type: 'ADD', qty, qtyAfter: qty, staffId: venueStaff[k % venueStaff.length].id,
          deviceId: null, reason: 'Opening stock', expiresAt: iso(expiresAt), transferGroup: null, clientId: null,
          unitPriceCents: null, amountCents: null, supplier: 'Opening stock', recordedById: null, createdAt: received,
        });
      }
    }
  });
  // A few weeks of office drinks history, so accounts and statements have something to show.
  const office = s.restaurants[2];
  const officeFridge = s.fridges.find((f) => f.restaurantId === office.id)!;
  const officeStaff = s.staff.filter((x) => x.restaurantId === office.id);
  const drinks = s.items.filter((i) => i.restaurantId === office.id);
  for (const b of s.batches.filter((x) => x.fridgeId === officeFridge.id)) b.qtyRemaining += 30;
  let n = 0;
  for (let day = 34; day >= 1; day--) {
    if (day % 7 === 0 || day % 7 === 6) continue; // weekends
    for (const person of officeStaff) {
      if ((day + person.name.length) % 3 === 0) continue;
      const it = drinks[(day + n++) % drinks.length];
      const b = s.batches.find((x) => x.fridgeId === officeFridge.id && x.itemId === it.id && x.qtyRemaining > 1);
      if (!b) continue;
      b.qtyRemaining -= 1;
      const at = new Date(now.getTime() - day * 86_400_000 + ((n % 6) - 3) * 3600_000);
      s.movements.push({
        id: id('m'), fridgeId: officeFridge.id, itemId: it.id, type: 'TAKE', qty: 1, qtyAfter: b.qtyRemaining, staffId: person.id, deviceId: null, reason: null,
        expiresAt: null, transferGroup: null, clientId: null, unitPriceCents: it.priceCents, amountCents: it.priceCents, supplier: null, recordedById: null, createdAt: iso(at),
      });
    }
  }
  const mgr = officeStaff.find((x) => x.role === 'MANAGER')!;
  const paidOn = iso(new Date(now.getTime() - 12 * 86_400_000));
  for (const [who, cents, method] of [['Maria', 12000, 'SALARY_DEDUCTION'], ['Tjeripo', 5000, 'CASH']] as const) {
    const person = officeStaff.find((x) => x.name === who)!;
    s.payments.push({ id: id('p'), restaurantId: office.id, staffId: person.id, amountCents: cents, method, paidOn, reference: method === 'CASH' ? 'Receipt 0412' : 'October payroll', recordedById: mgr.id, voidedAt: null, voidReason: null, createdAt: paidOn });
  }
  return s;
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s.v === VERSION) return s;
    }
  } catch {
    /* fall through to a fresh seed */
  }
  const s = seed();
  save(s);
  return s;
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: the demo just won't persist */
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('fs.userToken');
    localStorage.removeItem('fs.deviceToken');
    localStorage.removeItem('fs.offlineQueue');
    localStorage.removeItem('fs.restaurant');
  } catch {
    /* ignore */
  }
}

/** Demo shortcut: a device token for a fridge without going through a pairing code. */
export function demoPairFridge(fridgeId: string): string {
  const s = load();
  const f = s.fridges.find((x) => x.id === fridgeId) ?? fail(404, 'Fridge not found');
  const d: Device = { id: id('d'), fridgeId: f.id, name: `Demo tablet — ${f.name}`, failed: 0, lockedUntil: null, lastSeenAt: null, revokedAt: null, createdAt: iso(new Date()) };
  s.devices.push(d);
  save(s);
  return `demo-device:${d.id}`;
}
export function demoFridges() {
  const s = load();
  return s.fridges.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name, restaurantName: s.restaurants.find((r) => r.id === f.restaurantId)?.name ?? '' }));
}
export function demoSignInToken(email: string): string {
  const s = load();
  const p = s.staff.find((x) => x.email === email && x.active) ?? fail(401, 'No such demo account');
  return `demo-user:${p.id}`;
}

// ---------------------------------------------------------------- helpers

interface Principal { id: string; name: string; role: Role; restaurantId: string | null }
const RANK: Record<Role, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };

function principal(s: State, token: string | null, min: Role = 'MANAGER'): Principal {
  const sid = token?.startsWith('demo-user:') ? token.slice(10) : null;
  const p = s.staff.find((x) => x.id === sid);
  if (!p || !p.active || RANK[p.role] < RANK.MANAGER) fail(401, 'Please sign in');
  if (RANK[p!.role] < RANK[min]) fail(403, 'You are not allowed to do that');
  return { id: p!.id, name: p!.name, role: p!.role, restaurantId: p!.restaurantId };
}
function device(s: State, token: string | null) {
  const did = token?.startsWith('demo-device:') ? token.slice(12) : null;
  const d = s.devices.find((x) => x.id === did && !x.revokedAt);
  const f = d && s.fridges.find((x) => x.id === d.fridgeId && x.active);
  if (!d || !f) return fail(401, 'This tablet is not paired');
  d.lastSeenAt = iso(new Date());
  return { d, f, r: s.restaurants.find((x) => x.id === f.restaurantId)! };
}
const inScope = (p: Principal, restaurantId: string | null) => p.role === 'OWNER' || (!!restaurantId && restaurantId === p.restaurantId);
function restaurantIds(s: State, p: Principal, requested?: string | null): string[] {
  if (requested) {
    if (!inScope(p, requested)) fail(404, 'Restaurant not found');
    return [requested];
  }
  return p.role === 'OWNER' ? s.restaurants.map((r) => r.id) : [p.restaurantId!];
}
function fridgeFor(s: State, p: Principal, fid: string) {
  const f = s.fridges.find((x) => x.id === fid);
  if (!f || !inScope(p, f.restaurantId)) fail(404, 'Fridge not found');
  return f!;
}
function itemFor(s: State, p: Principal, iid: string) {
  const i = s.items.find((x) => x.id === iid);
  if (!i || !inScope(p, i.restaurantId)) fail(404, 'Item not found');
  return i!;
}
const batchesOf = (s: State, fridgeId: string, itemId: string) =>
  s.batches
    .filter((b) => b.fridgeId === fridgeId && b.itemId === itemId && b.qtyRemaining > 0)
    .map((b) => ({ ...b, expiresAt: new Date(b.expiresAt), receivedAt: new Date(b.receivedAt) }));
const qtyOf = (s: State, fridgeId: string, itemId: string) => totalQty(batchesOf(s, fridgeId, itemId));

function checkQty(q: number, unit: UnitName, allowZero = false) {
  const e = quantityError(q, unit, { allowZero });
  if (e) fail(400, e);
}
function ensureFridgeItem(s: State, fridgeId: string, itemId: string) {
  if (!s.fridgeItems.some((x) => x.fridgeId === fridgeId && x.itemId === itemId)) s.fridgeItems.push({ id: id('fi'), fridgeId, itemId, minQty: 0, parLevel: 0 });
}
function deduct(s: State, fridgeId: string, itemId: string, qty: number) {
  const r = consumeFifo(batchesOf(s, fridgeId, itemId), qty);
  if (!r.ok) fail(409, `Only ${r.available} in this fridge — cannot take ${qty}. If the count is wrong, a manager can correct it with a stock count.`, { available: r.available });
  const ok = r as Extract<typeof r, { ok: true }>;
  for (const d of ok.deductions) {
    const b = s.batches.find((x) => x.id === d.batchId)!;
    b.qtyRemaining = round3(b.qtyRemaining - d.qty);
  }
  return { deductions: ok.deductions, after: round3(ok.available - round3(qty)) };
}
type MoveInput = Pick<Movement, 'fridgeId' | 'itemId' | 'type' | 'qty' | 'qtyAfter' | 'staffId'> & Partial<Movement>;
function move(s: State, m: MoveInput): Movement {
  const full: Movement = { deviceId: null, reason: null, expiresAt: null, transferGroup: null, clientId: null, unitPriceCents: null, amountCents: null, supplier: null, recordedById: null, ...m, id: id('m'), createdAt: iso(new Date()) };
  s.movements.push(full);
  return full;
}

function stockLines(s: State, fridgeIds: string[], now = new Date()) {
  return s.fridgeItems
    .filter((fi) => fridgeIds.includes(fi.fridgeId))
    .map((fi) => {
      const f = s.fridges.find((x) => x.id === fi.fridgeId)!;
      const it = s.items.find((x) => x.id === fi.itemId)!;
      return { fi, f, it };
    })
    .filter(({ f, it }) => f.active && it.active)
    .map(({ fi, f, it }) => {
      const bs = fifoOrder(batchesOf(s, f.id, it.id));
      const qty = totalQty(bs);
      const { status, reorderQty } = stockStatus(qty, fi.minQty, fi.parLevel);
      const batches = bs.map((b) => ({ id: b.id, qty: round3(b.qtyRemaining), expiresAt: iso(b.expiresAt), receivedAt: iso(b.receivedAt), expiry: expiryStatus(b.expiresAt, now, EXPIRING_HOURS) }));
      const r = s.restaurants.find((x) => x.id === f.restaurantId)!;
      return {
        fridgeId: f.id, fridgeName: f.name, restaurantId: r.id, restaurantName: r.name, itemId: it.id, name: it.name, category: it.category, unit: it.unit,
        defaultShelfLifeDays: it.defaultShelfLifeDays, priceCents: it.priceCents, qty, minQty: fi.minQty, parLevel: fi.parLevel, status, reorderQty,
        expiry: worstExpiry(batches.map((b) => b.expiry)), nextExpiry: batches[0]?.expiresAt ?? null, batches,
      };
    })
    .sort((a, b) => a.fridgeName.localeCompare(b.fridgeName) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function dateRange(from: string | null, to: string | null, tz: string) {
  if (from && !parseDateString(from)) fail(400, 'Use a yyyy-mm-dd date');
  if (to && !parseDateString(to)) fail(400, 'Use a yyyy-mm-dd date');
  if (from && to && from > to) fail(400, '"From" is after "to"');
  const gte = from ? startOfLocalDay(from, tz).getTime() : -Infinity;
  const lt = to ? startOfLocalDay(addDays(to, 1), tz).getTime() : Infinity;
  return (t: string) => Date.parse(t) >= gte && Date.parse(t) < lt;
}

function movementView(s: State, m: Movement) {
  const f = s.fridges.find((x) => x.id === m.fridgeId)!;
  const r = s.restaurants.find((x) => x.id === f.restaurantId)!;
  const it = s.items.find((x) => x.id === m.itemId)!;
  const st = s.staff.find((x) => x.id === m.staffId);
  const d = s.devices.find((x) => x.id === m.deviceId);
  const by = s.staff.find((x) => x.id === m.recordedById);
  return { ...m, recordedBy: by ? { name: by.name } : null, fridge: { name: f.name, restaurant: { name: r.name, timezone: r.timezone } }, item: { name: it.name, unit: it.unit, category: it.category }, staff: { name: st?.name ?? '?' }, device: d ? { name: d.name } : null };
}

function filteredMovements(s: State, p: Principal, q: URLSearchParams) {
  const rids = restaurantIds(s, p, q.get('restaurantId'));
  const fids = new Set(s.fridges.filter((f) => rids.includes(f.restaurantId)).map((f) => f.id));
  if (q.get('fridgeId')) fridgeFor(s, p, q.get('fridgeId')!);
  const tz = s.restaurants.find((r) => r.id === rids[0])?.timezone ?? TZ;
  const inRange = dateRange(q.get('from'), q.get('to'), tz);
  return {
    tz,
    rows: s.movements
      .filter((m) => fids.has(m.fridgeId))
      .filter((m) => !q.get('fridgeId') || m.fridgeId === q.get('fridgeId'))
      .filter((m) => !q.get('itemId') || m.itemId === q.get('itemId'))
      .filter((m) => !q.get('staffId') || m.staffId === q.get('staffId'))
      .filter((m) => !q.get('type') || m.type === q.get('type'))
      .filter((m) => inRange(m.createdAt)),
  };
}

function usage(s: State, p: Principal, q: URLSearchParams) {
  const from = q.get('from') ?? fail(400, 'from: Required');
  const to = q.get('to') ?? fail(400, 'to: Required');
  const { tz, rows } = filteredMovements(s, p, new URLSearchParams({ ...(q.get('restaurantId') ? { restaurantId: q.get('restaurantId')! } : {}), ...(q.get('fridgeId') ? { fridgeId: q.get('fridgeId')! } : {}), from, to }));
  type Row = { date: string; itemId: string; name: string; category: string; unit: string; taken: number; wasted: number; added: number; salesCents: number };
  const daily = new Map<string, Row>();
  const reasons = new Map<string, number>();
  for (const m of rows) {
    if (!['TAKE', 'WASTE', 'ADD'].includes(m.type)) continue;
    const it = s.items.find((x) => x.id === m.itemId)!;
    const date = localDateString(new Date(m.createdAt), tz);
    const k = `${date}|${m.itemId}`;
    const e = daily.get(k) ?? { date, itemId: it.id, name: it.name, category: it.category, unit: it.unit, taken: 0, wasted: 0, added: 0, salesCents: 0 };
    if (m.type === 'TAKE') {
      e.taken = round3(e.taken + m.qty);
      e.salesCents += m.amountCents ?? 0;
    }
    if (m.type === 'WASTE') {
      e.wasted = round3(e.wasted + m.qty);
      reasons.set(m.reason ?? 'Unspecified', (reasons.get(m.reason ?? 'Unspecified') ?? 0) + 1);
    }
    if (m.type === 'ADD') e.added = round3(e.added + m.qty);
    daily.set(k, e);
  }
  const d = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const totals = new Map<string, Omit<Row, 'date'>>();
  for (const r of d) {
    const t = totals.get(r.itemId) ?? { itemId: r.itemId, name: r.name, category: r.category, unit: r.unit, taken: 0, wasted: 0, added: 0, salesCents: 0 };
    t.taken = round3(t.taken + r.taken);
    t.wasted = round3(t.wasted + r.wasted);
    t.added = round3(t.added + r.added);
    t.salesCents += r.salesCents;
    totals.set(r.itemId, t);
  }
  return {
    from, to, timezone: tz, daily: d, salesCents: d.reduce((a, r) => a + r.salesCents, 0),
    totals: [...totals.values()].sort((a, b) => b.taken + b.wasted - (a.taken + a.wasted)),
    wasteReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

const staffView = (x: Staff) => ({ id: x.id, name: x.name, role: x.role, restaurantId: x.restaurantId, email: x.email, active: x.active, canSignIn: x.role !== 'STAFF' && !!x.email });
const localStamp = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(d);

function pinFree(s: State, pin: string, restaurantId: string | null, role: Role, exceptId?: string) {
  const clash = s.staff.find((x) => x.active && x.pin === pin && x.id !== exceptId && (role === 'OWNER' || x.restaurantId === restaurantId || x.role === 'OWNER'));
  if (clash) fail(409, 'That PIN is already in use. Choose another.');
}

// ---------------------------------------------------------------- accounts

function ledger(s: State, r: Restaurant) {
  const fids = new Set(s.fridges.filter((f) => f.restaurantId === r.id).map((f) => f.id));
  const map = new Map<string, { charges: { date: string; amountCents: number; m: Movement }[]; payments: { date: string; amountCents: number; p: Payment }[] }>();
  const get = (k: string) => map.get(k) ?? (map.set(k, { charges: [], payments: [] }), map.get(k)!);
  for (const m of [...s.movements].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    if (m.type === 'TAKE' && m.amountCents !== null && fids.has(m.fridgeId)) get(m.staffId).charges.push({ date: localDateString(new Date(m.createdAt), r.timezone), amountCents: m.amountCents, m });
  for (const p of [...s.payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn)))
    if (p.restaurantId === r.id && !p.voidedAt) get(p.staffId).payments.push({ date: localDateString(new Date(p.paidOn), r.timezone), amountCents: p.amountCents, p });
  return map;
}
function balanceMap(s: State, r: Restaurant) {
  const tomorrow = addDays(localDateString(new Date(), r.timezone), 1);
  const out = new Map<string, { balanceCents: number; lastChargeOn: string | null; lastPaymentOn: string | null }>();
  for (const [k, l] of ledger(s, r))
    out.set(k, { balanceCents: statementTotals(l.charges, l.payments, tomorrow, tomorrow).openingCents, lastChargeOn: l.charges.at(-1)?.date ?? null, lastPaymentOn: l.payments.at(-1)?.date ?? null });
  return out;
}
function oneRestaurant(s: State, p: Principal, requested: string | null): Restaurant {
  let rid = requested;
  if (requested) restaurantIds(s, p, requested);
  else if (p.role !== 'OWNER') rid = p.restaurantId;
  else if (s.restaurants.length === 1) rid = s.restaurants[0].id;
  else fail(400, 'Choose a restaurant');
  return s.restaurants.find((r) => r.id === rid) ?? fail(404, 'Restaurant not found');
}
function holder(s: State, r: Restaurant, staffId: string) {
  return s.staff.find((x) => x.id === staffId && (x.restaurantId === r.id || x.role === 'OWNER')) ?? fail(404, 'Person not found');
}
function statementsFor(s: State, p: Principal, q: URLSearchParams) {
  const r = oneRestaurant(s, p, q.get('restaurantId'));
  const month = q.get('month') ?? fail(400, 'month: Required');
  if (!/^\d{4}-\d{2}$/.test(month)) fail(400, 'month: Use yyyy-mm');
  const { from, to } = statementPeriod(month, r.statementStartDay);
  const only = q.get('staffId');
  if (only) holder(s, r, only);
  const map = ledger(s, r);
  const ids = only ? [only] : [...map.keys()];
  const list = ids
    .map((sid) => {
      const person = s.staff.find((x) => x.id === sid)!;
      const l = map.get(sid) ?? { charges: [], payments: [] };
      const t = statementTotals(l.charges, l.payments, from, to);
      return {
        staff: { id: person.id, name: person.name, role: person.role, active: person.active },
        ...t,
        lines: l.charges.filter((c) => c.date >= from && c.date <= to).map((c) => {
          const it = s.items.find((x) => x.id === c.m.itemId)!;
          return { date: c.date, at: c.m.createdAt, item: it.name, unit: it.unit, fridge: s.fridges.find((f) => f.id === c.m.fridgeId)!.name, qty: c.m.qty, unitPriceCents: c.m.unitPriceCents, amountCents: c.amountCents };
        }),
        payments: l.payments.filter((x) => x.date >= from && x.date <= to).map((x) => ({ date: x.date, method: x.p.method, reference: x.p.reference, amountCents: x.amountCents })),
      };
    })
    .filter((x) => only || x.lines.length || x.payments.length || x.closingCents !== 0)
    .sort((a, b) => a.staff.name.localeCompare(b.staff.name));
  return {
    restaurant: { id: r.id, name: r.name, timezone: r.timezone },
    period: { month, from, to, startDay: r.statementStartDay },
    generatedAt: iso(new Date()),
    statements: list,
    totals: { purchasesCents: list.reduce((a, x) => a + x.purchasesCents, 0), paidCents: list.reduce((a, x) => a + x.paidCents, 0), closingCents: list.reduce((a, x) => a + x.closingCents, 0) },
  };
}

// ---------------------------------------------------------------- router

type Body = Record<string, unknown>;
export interface DemoRequest {
  method: string;
  url: string;
  body?: unknown;
  userToken: string | null;
  deviceToken: string | null;
}

export async function demoFetch(req: DemoRequest): Promise<{ status: number; data: unknown; csv?: string; filename?: string }> {
  await new Promise((r) => setTimeout(r, 120)); // feel like a network
  const s = load();
  try {
    const out = route(s, req);
    save(s);
    return out;
  } catch (e) {
    if (e instanceof DemoHttpError) {
      save(s); // keep PIN-lockout counters etc.
      throw e;
    }
    throw e;
  }
}

function route(s: State, req: DemoRequest): { status: number; data: unknown; csv?: string; filename?: string } {
  const u = new URL(req.url, 'http://demo');
  const path = u.pathname;
  const q = u.searchParams;
  const b = (req.body ?? {}) as Body;
  const M = req.method;
  const ok = (data: unknown) => ({ status: 200, data });
  const seg = path.split('/').filter(Boolean);
  const now = new Date();

  // ---- kiosk
  if (M === 'POST' && path === '/kiosk/pair') {
    const code = String(b.code ?? '');
    const pc = s.pairings.find((x) => x.code === code && !x.used && Date.parse(x.expiresAt) > now.getTime());
    if (!pc) fail(400, 'That code is not valid or has expired. Ask a manager for a new one.');
    pc!.used = true;
    const f = s.fridges.find((x) => x.id === pc!.fridgeId)!;
    const d: Device = { id: id('d'), fridgeId: f.id, name: pc!.deviceName, failed: 0, lockedUntil: null, lastSeenAt: null, revokedAt: null, createdAt: iso(now) };
    s.devices.push(d);
    return ok({ token: `demo-device:${d.id}`, device: { id: d.id, name: d.name }, fridge: { id: f.id, name: f.name } });
  }
  if (M === 'GET' && path === '/kiosk/fridge') {
    const { d, f, r } = device(s, req.deviceToken);
    return ok({
      device: { id: d.id, name: d.name }, fridge: { id: f.id, name: f.name }, restaurant: { id: r.id, name: r.name, timezone: r.timezone }, expiringHours: EXPIRING_HOURS,
      items: stockLines(s, [f.id]), otherFridges: s.fridges.filter((x) => x.restaurantId === r.id && x.active && x.id !== f.id).map((x) => ({ id: x.id, name: x.name })),
      serverTime: iso(now),
    });
  }
  if (M === 'POST' && path === '/kiosk/movements') {
    const { d, f, r } = device(s, req.deviceToken);
    if (d.lockedUntil && Date.parse(d.lockedUntil) > now.getTime()) fail(429, `Too many wrong PINs. Try again in ${Math.ceil((Date.parse(d.lockedUntil) - now.getTime()) / 1000)} seconds.`);
    const staff = s.staff.find((x) => x.active && x.pin === b.pin && (x.restaurantId === r.id || x.role === 'OWNER'));
    if (!staff) {
      d.failed += 1;
      if (d.failed >= 5) {
        d.failed = 0;
        d.lockedUntil = iso(new Date(now.getTime() + 60_000));
        fail(429, 'Too many wrong PINs. Try again in 60 seconds.');
      }
      fail(401, 'PIN not recognised');
    }
    d.failed = 0;
    d.lockedUntil = null;
    const clientId = typeof b.clientId === 'string' ? b.clientId : null;
    const prior = clientId && s.movements.find((m) => m.clientId === clientId);
    if (prior) return ok({ movement: prior, staff: { id: staff!.id, name: staff!.name } });
    const it = s.items.find((x) => x.id === b.itemId && x.active);
    if (!it || !s.fridgeItems.some((x) => x.fridgeId === f.id && x.itemId === it.id)) fail(404, 'This item is not kept in this fridge');
    const qty = Number(b.qty);
    checkQty(qty, it!.unit);
    const base = { fridgeId: f.id, itemId: it!.id, staffId: staff!.id, deviceId: d.id, clientId };
    let movement: Movement;
    if (b.type === 'ADD') {
      let exp: Date;
      if (b.expiresOn) {
        if (!parseDateString(String(b.expiresOn))) fail(400, 'Use-by date is not a valid date');
        exp = endOfLocalDay(String(b.expiresOn), r.timezone);
      } else exp = defaultExpiry(now, it!.defaultShelfLifeDays, r.timezone);
      const before = qtyOf(s, f.id, it!.id);
      s.batches.push({ id: id('b'), fridgeId: f.id, itemId: it!.id, qtyRemaining: qty, expiresAt: iso(exp), receivedAt: iso(now) });
      movement = move(s, { ...base, type: 'ADD', qty, qtyAfter: round3(before + qty), expiresAt: iso(exp), reason: (b.reason as string) || null });
    } else if (b.type === 'TRANSFER') {
      const to = s.fridges.find((x) => x.id === b.toFridgeId && x.restaurantId === r.id && x.active && x.id !== f.id);
      if (!to) fail(404, 'That fridge is not in this restaurant');
      const { deductions, after } = deduct(s, f.id, it!.id, qty);
      const group = id('t');
      movement = move(s, { ...base, type: 'TRANSFER_OUT', qty, qtyAfter: after, transferGroup: group });
      ensureFridgeItem(s, to!.id, it!.id);
      let running = qtyOf(s, to!.id, it!.id);
      for (const dd of deductions) {
        s.batches.push({ id: id('b'), fridgeId: to!.id, itemId: it!.id, qtyRemaining: dd.qty, expiresAt: iso(dd.expiresAt), receivedAt: iso(now) });
        running = round3(running + dd.qty);
        move(s, { fridgeId: to!.id, itemId: it!.id, staffId: staff!.id, deviceId: d.id, type: 'TRANSFER_IN', qty: dd.qty, qtyAfter: running, expiresAt: iso(dd.expiresAt), transferGroup: group });
      }
    } else if (b.type === 'TAKE' || b.type === 'WASTE') {
      const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
      if (b.type === 'WASTE' && !reason) fail(400, 'Say why it was thrown away');
      const { after } = deduct(s, f.id, it!.id, qty);
      const price = b.type === 'TAKE' ? it!.priceCents : null;
      movement = move(s, { ...base, type: b.type, qty, qtyAfter: after, reason: reason || null, unitPriceCents: price, amountCents: price === null ? null : chargeFor(qty, price) });
    } else return fail(400, 'type: Invalid');
    const account = movement.amountCents !== null ? { chargedCents: movement.amountCents, balanceCents: balanceMap(s, r).get(staff!.id)?.balanceCents ?? movement.amountCents } : null;
    return ok({ movement, staff: { id: staff!.id, name: staff!.name }, account });
  }

  // ---- auth
  if (M === 'POST' && path === '/auth/login') {
    const p = s.staff.find((x) => x.email === String(b.email ?? '').toLowerCase() && x.active && x.role !== 'STAFF');
    if (!p || b.password !== 'demo') fail(401, 'Email or password is wrong (demo password: demo)');
    return ok({ token: `demo-user:${p!.id}`, user: { id: p!.id, name: p!.name, role: p!.role, restaurantId: p!.restaurantId } });
  }
  if (M === 'GET' && path === '/auth/me') {
    const p = principal(s, req.userToken);
    return ok({ ...p, restaurantName: s.restaurants.find((r) => r.id === p.restaurantId)?.name ?? null });
  }

  const p = principal(s, req.userToken);

  // ---- restaurants
  if (path === '/restaurants') {
    if (M === 'GET') return ok(s.restaurants.filter((r) => inScope(p, r.id)).sort((a, b2) => a.name.localeCompare(b2.name)));
    if (M === 'POST') {
      principal(s, req.userToken, 'OWNER');
      const name = String(b.name ?? '').trim();
      if (!name) fail(400, 'name: Required');
      if (s.restaurants.some((r) => r.name === name)) fail(409, 'That name is already used');
      const r: Restaurant = { id: id('r'), name, timezone: String(b.timezone ?? TZ), statementStartDay: Number(b.statementStartDay ?? 16), active: true, createdAt: iso(now) };
      s.restaurants.push(r);
      return ok(r);
    }
  }
  if (seg[0] === 'restaurants' && seg.length === 2 && M === 'PATCH') {
    principal(s, req.userToken, 'OWNER');
    const r = s.restaurants.find((x) => x.id === seg[1]) ?? fail(404, 'Restaurant not found');
    if (typeof b.name === 'string' && b.name.trim()) r.name = b.name.trim();
    if (b.statementStartDay !== undefined) {
      const d = Number(b.statementStartDay);
      if (!Number.isInteger(d) || d < 1 || d > 28) fail(400, 'statementStartDay: 1 to 28');
      r.statementStartDay = d;
    }
    return ok(r);
  }

  // ---- fridges
  if (path === '/fridges') {
    if (M === 'GET') {
      const rids = restaurantIds(s, p, q.get('restaurantId'));
      return ok(
        s.fridges
          .filter((f) => rids.includes(f.restaurantId))
          .map((f) => ({
            ...f, restaurantName: s.restaurants.find((r) => r.id === f.restaurantId)!.name, itemCount: s.fridgeItems.filter((x) => x.fridgeId === f.id).length,
            deviceCount: s.devices.filter((d) => d.fridgeId === f.id && !d.revokedAt).length,
          }))
          .sort((a, b2) => a.restaurantName.localeCompare(b2.restaurantName) || a.name.localeCompare(b2.name)),
      );
    }
    if (M === 'POST') {
      const rid = p.role === 'OWNER' ? String(b.restaurantId ?? '') : p.restaurantId!;
      if (!s.restaurants.some((r) => r.id === rid) || !inScope(p, rid)) fail(404, 'Restaurant not found');
      const name = String(b.name ?? '').trim();
      if (!name) fail(400, 'name: Required');
      if (s.fridges.some((f) => f.restaurantId === rid && f.name === name)) fail(409, 'That name is already used');
      const f: Fridge = { id: id('f'), restaurantId: rid, name, kind: String(b.kind ?? 'REACH_IN'), active: true, createdAt: iso(now) };
      s.fridges.push(f);
      return ok(f);
    }
  }
  if (seg[0] === 'fridges' && seg.length === 2 && M === 'PATCH') {
    const f = fridgeFor(s, p, seg[1]);
    if (typeof b.name === 'string' && b.name.trim()) f.name = b.name.trim();
    if (typeof b.kind === 'string') f.kind = b.kind;
    if (typeof b.active === 'boolean') f.active = b.active;
    return ok(f);
  }
  if (seg[0] === 'fridges' && seg[2] === 'items') {
    const f = fridgeFor(s, p, seg[1]);
    if (seg.length === 3 && M === 'GET') return ok(stockLines(s, [f.id]));
    const it = itemFor(s, p, seg[3]);
    if (it.restaurantId !== f.restaurantId) fail(400, 'That item belongs to another restaurant');
    if (M === 'PUT') {
      const minQty = Number(b.minQty ?? 0);
      const parLevel = Number(b.parLevel ?? 0);
      checkQty(minQty, it.unit, true);
      checkQty(parLevel, it.unit, true);
      ensureFridgeItem(s, f.id, it.id);
      const fi = s.fridgeItems.find((x) => x.fridgeId === f.id && x.itemId === it.id)!;
      fi.minQty = minQty;
      fi.parLevel = parLevel;
      return ok(fi);
    }
    if (M === 'DELETE') {
      if (qtyOf(s, f.id, it.id) > 0) fail(409, 'This fridge still holds some of it. Take, move or count it to zero first.');
      s.fridgeItems = s.fridgeItems.filter((x) => !(x.fridgeId === f.id && x.itemId === it.id));
      return ok({ ok: true });
    }
  }
  if (seg[0] === 'fridges' && seg[2] === 'pairing-codes' && M === 'POST') {
    const f = fridgeFor(s, p, seg[1]);
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const expiresAt = iso(new Date(now.getTime() + 15 * 60_000));
    s.pairings.push({ code, fridgeId: f.id, deviceName: String(b.deviceName ?? 'Tablet'), expiresAt, used: false });
    return ok({ code, expiresAt, fridgeName: f.name });
  }

  // ---- items
  if (path === '/items') {
    if (M === 'GET') {
      const rids = restaurantIds(s, p, q.get('restaurantId'));
      return ok(s.items.filter((i) => rids.includes(i.restaurantId)).sort((a, b2) => a.category.localeCompare(b2.category) || a.name.localeCompare(b2.name)));
    }
    if (M === 'POST') {
      const rid = p.role === 'OWNER' ? String(b.restaurantId ?? '') : p.restaurantId!;
      if (!s.restaurants.some((r) => r.id === rid) || !inScope(p, rid)) fail(404, 'Restaurant not found');
      const name = String(b.name ?? '').trim();
      if (!name) fail(400, 'name: Required');
      if (s.items.some((i) => i.restaurantId === rid && i.name === name)) fail(409, 'That name is already used');
      const it: Item = { id: id('i'), restaurantId: rid, name, category: String(b.category || 'General'), unit: (b.unit as UnitName) ?? 'EACH', defaultShelfLifeDays: Number(b.defaultShelfLifeDays ?? 3), priceCents: typeof b.priceCents === 'number' ? b.priceCents : null, active: true, createdAt: iso(now) };
      s.items.push(it);
      return ok(it);
    }
  }
  if (seg[0] === 'items' && seg.length === 2 && M === 'PATCH') {
    const it = itemFor(s, p, seg[1]);
    if (b.unit && b.unit !== it.unit && s.batches.some((x) => x.itemId === it.id && x.qtyRemaining > 0)) fail(409, 'Cannot change the unit while this item is in stock — the quantities would change meaning.');
    if (typeof b.name === 'string' && b.name.trim()) it.name = b.name.trim();
    if (typeof b.category === 'string' && b.category.trim()) it.category = b.category.trim();
    if (typeof b.unit === 'string') it.unit = b.unit as UnitName;
    if (b.defaultShelfLifeDays !== undefined) it.defaultShelfLifeDays = Number(b.defaultShelfLifeDays);
    if (typeof b.active === 'boolean') it.active = b.active;
    if (b.priceCents !== undefined) it.priceCents = typeof b.priceCents === 'number' && b.priceCents >= 0 ? Math.round(b.priceCents) : null;
    return ok(it);
  }

  // ---- staff
  if (path === '/staff') {
    if (M === 'GET') {
      const rid = q.get('restaurantId') || (p.role === 'OWNER' ? null : p.restaurantId);
      if (rid && !inScope(p, rid)) fail(404, 'Restaurant not found');
      return ok(s.staff.filter((x) => !rid || x.restaurantId === rid || x.role === 'OWNER').sort((a, b2) => Number(b2.active) - Number(a.active) || a.name.localeCompare(b2.name)).map(staffView));
    }
    if (M === 'POST') {
      const role = (b.role as Role) ?? 'STAFF';
      if (role === 'OWNER' && p.role !== 'OWNER') fail(403, 'Only an owner can add an owner');
      const rid = role === 'OWNER' ? null : p.role === 'OWNER' ? String(b.restaurantId ?? '') : p.restaurantId;
      if (rid && !s.restaurants.some((r) => r.id === rid)) fail(404, 'Restaurant not found');
      const pin = String(b.pin ?? '');
      if (!/^\d{4,6}$/.test(pin)) fail(400, 'pin: PIN is 4 to 6 digits');
      if (role !== 'STAFF' && !b.email) fail(400, 'Managers and owners need an email and password to sign in');
      pinFree(s, pin, rid, role);
      const x: Staff = { id: id('s'), restaurantId: rid, name: String(b.name ?? '').trim(), role, pin, email: role === 'STAFF' ? null : String(b.email).toLowerCase(), active: true };
      s.staff.push(x);
      return ok(staffView(x));
    }
  }
  if (seg[0] === 'staff' && seg.length === 2 && M === 'PATCH') {
    const x = s.staff.find((y) => y.id === seg[1]);
    if (!x || (p.role !== 'OWNER' && (x.role === 'OWNER' || x.restaurantId !== p.restaurantId))) return fail(404, 'Person not found');
    if (b.role === 'OWNER' && p.role !== 'OWNER') fail(403, 'Only an owner can make someone an owner');
    if (x.id === p.id && (b.active === false || (b.role && b.role !== x.role))) fail(400, 'You cannot deactivate yourself or change your own role');
    const role = (b.role as Role) ?? x.role;
    const pin = typeof b.pin === 'string' && b.pin ? b.pin : x.pin;
    const active = typeof b.active === 'boolean' ? b.active : x.active;
    if (active && (pin !== x.pin || role !== x.role || !x.active)) pinFree(s, pin, x.restaurantId, role, x.id);
    Object.assign(x, { name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : x.name, role, pin, active, email: role === 'STAFF' ? null : (b.email as string | undefined) ?? x.email });
    return ok(staffView(x));
  }

  // ---- devices
  if (path === '/devices' && M === 'GET') {
    const rids = restaurantIds(s, p, q.get('restaurantId'));
    return ok(
      s.devices
        .filter((d) => rids.includes(s.fridges.find((f) => f.id === d.fridgeId)!.restaurantId))
        .map((d) => {
          const f = s.fridges.find((x) => x.id === d.fridgeId)!;
          return { id: d.id, name: d.name, fridgeId: f.id, fridgeName: f.name, restaurantName: s.restaurants.find((r) => r.id === f.restaurantId)!.name, lastSeenAt: d.lastSeenAt, revokedAt: d.revokedAt, createdAt: d.createdAt };
        })
        .reverse(),
    );
  }
  if (seg[0] === 'devices' && seg.length === 2 && M === 'DELETE') {
    const d = s.devices.find((x) => x.id === seg[1]);
    if (!d || !inScope(p, s.fridges.find((f) => f.id === d.fridgeId)!.restaurantId)) return fail(404, 'Tablet not found');
    d.revokedAt ??= iso(now);
    return ok({ ok: true });
  }

  // ---- dashboard
  if (path === '/dashboard' && M === 'GET') {
    const rids = restaurantIds(s, p, q.get('restaurantId'));
    const lines = stockLines(s, s.fridges.filter((f) => rids.includes(f.restaurantId)).map((f) => f.id));
    const since = now.getTime() - 24 * 3600_000;
    const fids = new Set(s.fridges.filter((f) => rids.includes(f.restaurantId)).map((f) => f.id));
    const last24h: Record<string, number> = {};
    for (const m of s.movements) if (fids.has(m.fridgeId) && Date.parse(m.createdAt) >= since) last24h[m.type] = (last24h[m.type] ?? 0) + 1;
    return ok({
      summary: s.restaurants
        .filter((r) => rids.includes(r.id))
        .sort((a, b2) => a.name.localeCompare(b2.name))
        .map((r) => {
          const mine = lines.filter((l) => l.restaurantId === r.id);
          const todayStart = startOfLocalDay(localDateString(now, r.timezone), r.timezone).getTime();
          const rf = new Set(s.fridges.filter((f) => f.restaurantId === r.id).map((f) => f.id));
          return {
            stockValueCents: mine.reduce((a, l) => a + (l.priceCents ? chargeFor(l.qty, l.priceCents) : 0), 0),
            salesTodayCents: s.movements.filter((m) => m.type === 'TAKE' && rf.has(m.fridgeId) && Date.parse(m.createdAt) >= todayStart).reduce((a, m) => a + (m.amountCents ?? 0), 0),
            owedCents: [...balanceMap(s, r).values()].reduce((a, x) => a + Math.max(0, x.balanceCents), 0),
            id: r.id, name: r.name, fridges: s.fridges.filter((f) => f.restaurantId === r.id && f.active).length, items: mine.length,
            low: mine.filter((l) => l.status === 'LOW').length, out: mine.filter((l) => l.status === 'OUT').length,
            expiring: mine.filter((l) => l.expiry === 'EXPIRING').length, expired: mine.filter((l) => l.expiry === 'EXPIRED').length,
          };
        }),
      reorder: lines.filter((l) => l.status !== 'OK'),
      expiring: lines
        .flatMap((l) => l.batches.filter((x) => x.expiry !== 'FRESH').map((x) => ({ ...x, fridgeId: l.fridgeId, fridgeName: l.fridgeName, restaurantName: l.restaurantName, itemId: l.itemId, name: l.name, unit: l.unit })))
        .sort((a, b2) => a.expiresAt.localeCompare(b2.expiresAt)),
      last24h,
    });
  }

  // ---- history
  if (path === '/movements' && M === 'GET') {
    const { rows } = filteredMovements(s, p, q);
    const page = Math.max(1, Number(q.get('page') ?? 1));
    const limit = Math.min(200, Math.max(1, Number(q.get('limit') ?? 50)));
    const sorted = [...rows].sort((a, b2) => b2.createdAt.localeCompare(a.createdAt) || b2.id.localeCompare(a.id));
    return ok({ total: rows.length, page, limit, rows: sorted.slice((page - 1) * limit, page * limit).map((m) => movementView(s, m)) });
  }
  if (path === '/movements.csv' && M === 'GET') {
    const { rows, tz } = filteredMovements(s, p, q);
    const csv = toCsv([
      ['When', 'Restaurant', 'Fridge', 'Item', 'Category', 'Type', 'Qty', 'Unit', 'Stock after', 'Who', 'Tablet', 'Entered by', 'Unit price', 'Charged', 'Supplier', 'Reason', 'Use-by'],
      ...[...rows].sort((a, b2) => a.createdAt.localeCompare(b2.createdAt)).map((m) => {
        const v = movementView(s, m);
        return [localStamp(new Date(m.createdAt), tz), v.fridge.restaurant.name, v.fridge.name, v.item.name, v.item.category, m.type, m.qty, v.item.unit, m.qtyAfter, v.staff.name, v.device?.name ?? '', v.recordedBy?.name ?? '', m.unitPriceCents === null ? '' : formatCents(m.unitPriceCents), m.amountCents === null ? '' : formatCents(m.amountCents), m.supplier ?? '', m.reason ?? '', m.expiresAt ? localDateString(new Date(m.expiresAt), tz) : ''];
      }),
    ]);
    return { status: 200, data: null, csv, filename: `movements-${localDateString(now, tz)}.csv` };
  }

  // ---- reports
  if (path === '/reports/usage' && M === 'GET') return ok(usage(s, p, q));
  if (path === '/reports/usage.csv' && M === 'GET') {
    const u2 = usage(s, p, q);
    const csv = toCsv([['Date', 'Item', 'Category', 'Unit', 'Taken', 'Wasted', 'Added'], ...u2.daily.map((r) => [r.date, r.name, r.category, r.unit, r.taken, r.wasted, r.added])]);
    return { status: 200, data: null, csv, filename: `usage-${u2.from}-to-${u2.to}.csv` };
  }

  // ---- stock count
  if (path === '/stock-counts' && M === 'POST') {
    const f = fridgeFor(s, p, String(b.fridgeId ?? ''));
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) fail(400, 'reason: Give a reason for the count');
    const counts = (b.counts as { itemId: string; countedQty: number }[]) ?? [];
    if (counts.length === 0) fail(400, 'counts: Required');
    const r = s.restaurants.find((x) => x.id === f.restaurantId)!;
    const items = counts.map((c) => {
      const it = s.items.find((x) => x.id === c.itemId && x.restaurantId === f.restaurantId);
      if (!it) fail(400, 'An item does not belong to this restaurant');
      checkQty(Number(c.countedQty), it!.unit, true);
      return { it: it!, counted: Number(c.countedQty) };
    });
    const out: Movement[] = [];
    for (const { it, counted } of items) {
      ensureFridgeItem(s, f.id, it.id);
      const current = qtyOf(s, f.id, it.id);
      const delta = round3(counted - current);
      if (delta === 0) continue;
      let exp: string | null = null;
      if (delta > 0) {
        exp = iso(defaultExpiry(now, it.defaultShelfLifeDays, r.timezone));
        s.batches.push({ id: id('b'), fridgeId: f.id, itemId: it.id, qtyRemaining: delta, expiresAt: exp, receivedAt: iso(now) });
      } else deduct(s, f.id, it.id, -delta);
      out.push(move(s, { fridgeId: f.id, itemId: it.id, staffId: p.id, type: 'ADJUST', qty: delta, qtyAfter: counted, reason, expiresAt: exp }));
    }
    return ok({ adjusted: out.length, movements: out });
  }

  // ---- accounts, payments, statements
  if (path === '/accounts' && M === 'GET') {
    const r = oneRestaurant(s, p, q.get('restaurantId'));
    const bal = balanceMap(s, r);
    const month = periodMonthFor(localDateString(now, r.timezone), r.statementStartDay);
    const rows = s.staff
      .filter((x) => x.restaurantId === r.id || x.role === 'OWNER')
      .map((x) => ({ staffId: x.id, name: x.name, role: x.role, active: x.active, ...(bal.get(x.id) ?? { balanceCents: 0, lastChargeOn: null, lastPaymentOn: null }) }))
      .filter((x) => x.active || x.balanceCents !== 0)
      .sort((a, b2) => b2.balanceCents - a.balanceCents || a.name.localeCompare(b2.name));
    return ok({
      restaurant: { id: r.id, name: r.name, timezone: r.timezone, statementStartDay: r.statementStartDay },
      currentPeriod: { month, ...statementPeriod(month, r.statementStartDay) },
      totalOwedCents: rows.reduce((a, x) => a + Math.max(0, x.balanceCents), 0),
      rows,
    });
  }
  if (path === '/payments' && M === 'GET') {
    const r = oneRestaurant(s, p, q.get('restaurantId'));
    return ok(
      s.payments
        .filter((x) => x.restaurantId === r.id && (!q.get('staffId') || x.staffId === q.get('staffId')))
        .sort((a, b2) => b2.paidOn.localeCompare(a.paidOn) || b2.createdAt.localeCompare(a.createdAt))
        .map((x) => ({ ...x, staff: { name: s.staff.find((y) => y.id === x.staffId)!.name }, recordedBy: { name: s.staff.find((y) => y.id === x.recordedById)!.name } })),
    );
  }
  if (path === '/payments' && M === 'POST') {
    const r = oneRestaurant(s, p, (b.restaurantId as string) ?? null);
    holder(s, r, String(b.staffId ?? ''));
    const cents = Number(b.amountCents);
    if (!Number.isInteger(cents) || cents < 1) fail(400, 'amountCents: Amount must be more than zero');
    const day = String(b.paidOn ?? '');
    if (!parseDateString(day)) fail(400, 'paidOn: Use a yyyy-mm-dd date');
    const paidOn = iso(new Date(startOfLocalDay(day, r.timezone).getTime() + 12 * 3600_000));
    if (Date.parse(paidOn) > now.getTime() + 36 * 3600_000) fail(400, 'A payment cannot be dated in the future');
    const pay: Payment = { id: id('p'), restaurantId: r.id, staffId: String(b.staffId), amountCents: cents, method: String(b.method ?? 'CASH'), paidOn, reference: (b.reference as string) || null, recordedById: p.id, voidedAt: null, voidReason: null, createdAt: iso(now) };
    s.payments.push(pay);
    return ok(pay);
  }
  if (seg[0] === 'payments' && seg[2] === 'void' && M === 'POST') {
    const pay = s.payments.find((x) => x.id === seg[1] && inScope(p, x.restaurantId)) ?? fail(404, 'Payment not found');
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) fail(400, 'reason: Say why it is being voided');
    if (pay.voidedAt) fail(409, 'That payment is already voided');
    pay.voidedAt = iso(now);
    pay.voidReason = reason;
    return ok({ ok: true });
  }
  if (path === '/statements' && M === 'GET') return ok(statementsFor(s, p, q));
  if (path === '/statements.csv' && M === 'GET') {
    const st = statementsFor(s, p, q);
    const csv = toCsv([
      ['Person', 'Period from', 'Period to', 'Opening balance', 'Purchases', 'Payments', 'Balance due'],
      ...st.statements.map((x) => [x.staff.name, st.period.from, st.period.to, formatCents(x.openingCents), formatCents(x.purchasesCents), formatCents(x.paidCents), formatCents(x.closingCents)]),
    ]);
    return { status: 200, data: null, csv, filename: `statements-${st.period.from}-to-${st.period.to}.csv` };
  }

  // ---- back-office entry: receive a delivery, or record a take/waste for someone
  if (path === '/movements' && M === 'POST') {
    const f = fridgeFor(s, p, String(b.fridgeId ?? ''));
    const r = s.restaurants.find((x) => x.id === f.restaurantId)!;
    const it = s.items.find((x) => x.id === b.itemId && x.active);
    if (!it || !s.fridgeItems.some((x) => x.fridgeId === f.id && x.itemId === it.id)) fail(404, 'This item is not kept in this fridge');
    const who = b.staffId ? holder(s, r, String(b.staffId)) : null;
    const qty = Number(b.qty);
    checkQty(qty, it!.unit);
    const base = { fridgeId: f.id, itemId: it!.id, staffId: who?.id ?? p.id, recordedById: p.id };
    if (b.type === 'ADD') {
      const exp = b.expiresOn && parseDateString(String(b.expiresOn)) ? endOfLocalDay(String(b.expiresOn), r.timezone) : defaultExpiry(now, it!.defaultShelfLifeDays, r.timezone);
      const before = qtyOf(s, f.id, it!.id);
      s.batches.push({ id: id('b'), fridgeId: f.id, itemId: it!.id, qtyRemaining: qty, expiresAt: iso(exp), receivedAt: iso(now) });
      return ok({ movement: move(s, { ...base, type: 'ADD', qty, qtyAfter: round3(before + qty), expiresAt: iso(exp), supplier: (b.supplier as string)?.trim() || null }) });
    }
    if (b.type === 'TAKE' || b.type === 'WASTE') {
      const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
      if (b.type === 'WASTE' && !reason) fail(400, 'Say why it was thrown away');
      const { after } = deduct(s, f.id, it!.id, qty);
      const price = b.type === 'TAKE' ? it!.priceCents : null;
      return ok({ movement: move(s, { ...base, type: b.type, qty, qtyAfter: after, reason: reason || null, unitPriceCents: price, amountCents: price === null ? null : chargeFor(qty, price) }) });
    }
    return fail(400, 'type: Invalid');
  }

  return fail(404, `Not available in the demo: ${M} ${path}`);
}
