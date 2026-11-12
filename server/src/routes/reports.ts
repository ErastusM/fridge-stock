import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MovementType, Prisma } from '@prisma/client';
import { db } from '../db';
import { badRequest } from '../errors';
import { fridgeInScope, principalOf, requireRole, restaurantFilter } from '../principal';
import { adjustStock, runStockTransaction } from '../services/stock';
import { stockLines } from '../services/view';
import { addDays, localDateString, parseDateString, startOfLocalDay } from '../domain/time';
import { round3 } from '../domain/fifo';
import { toCsv } from '../domain/csv';

const manager = { preHandler: requireRole('MANAGER') };
const DEFAULT_TZ = 'Africa/Windhoek';

const dateStr = z.string().refine((s) => parseDateString(s) !== null, 'Use a yyyy-mm-dd date');

const MovementQuery = z.object({
  restaurantId: z.string().optional(),
  fridgeId: z.string().optional(),
  itemId: z.string().optional(),
  staffId: z.string().optional(),
  type: z.nativeEnum(MovementType).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const UsageQuery = z.object({
  restaurantId: z.string().optional(),
  fridgeId: z.string().optional(),
  from: dateStr,
  to: dateStr,
});

const StockCountBody = z.object({
  fridgeId: z.string(),
  reason: z.string().trim().min(3, 'Give a reason for the count').max(200),
  counts: z.array(z.object({ itemId: z.string(), countedQty: z.number() })).min(1).max(500),
});

async function tzFor(restaurantId?: string) {
  if (!restaurantId) return DEFAULT_TZ;
  return (await db.restaurant.findUnique({ where: { id: restaurantId } }))?.timezone ?? DEFAULT_TZ;
}

/** from/to are local calendar days, both inclusive. */
function dateRange(from: string | undefined, to: string | undefined, tz: string) {
  if (from && to && from > to) throw badRequest('"From" is after "to"');
  return {
    ...(from ? { gte: startOfLocalDay(from, tz) } : {}),
    ...(to ? { lt: startOfLocalDay(addDays(to, 1), tz) } : {}),
  };
}

async function movementWhere(req: Parameters<typeof principalOf>[0], q: z.infer<typeof MovementQuery>) {
  const p = principalOf(req);
  if (q.fridgeId) await fridgeInScope(p, q.fridgeId);
  const scope = restaurantFilter(p, q.restaurantId);
  const tz = await tzFor(scope.restaurantId);
  const range = dateRange(q.from, q.to, tz);
  const where: Prisma.MovementWhereInput = {
    fridge: scope,
    ...(q.fridgeId ? { fridgeId: q.fridgeId } : {}),
    ...(q.itemId ? { itemId: q.itemId } : {}),
    ...(q.staffId ? { staffId: q.staffId } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(Object.keys(range).length ? { createdAt: range } : {}),
  };
  return { where, tz };
}

const movementInclude = {
  fridge: { select: { name: true, restaurant: { select: { name: true, timezone: true } } } },
  item: { select: { name: true, unit: true, category: true } },
  staff: { select: { name: true } },
  device: { select: { name: true } },
} satisfies Prisma.MovementInclude;

function sendCsv(reply: FastifyReply, filename: string, body: string) {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send('﻿' + body); // BOM so Excel reads the UTF-8 correctly
}

function localStamp(d: Date, tz: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(d);
}

export async function reportRoutes(app: FastifyInstance) {
  /** What needs reordering and what needs using (or binning) first, across the caller's scope. */
  app.get('/dashboard', manager, async (req) => {
    const p = principalOf(req);
    const q = z.object({ restaurantId: z.string().optional() }).parse(req.query);
    const scope = restaurantFilter(p, q.restaurantId);
    const lines = await stockLines({ restaurantId: scope.restaurantId });
    const reorder = lines.filter((l) => l.status !== 'OK');
    const expiring = lines
      .flatMap((l) => l.batches.filter((b) => b.expiry !== 'FRESH').map((b) => ({ ...b, fridgeId: l.fridgeId, fridgeName: l.fridgeName, restaurantName: l.restaurantName, itemId: l.itemId, name: l.name, unit: l.unit })))
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

    const restaurants = await db.restaurant.findMany({
      where: scope.restaurantId ? { id: scope.restaurantId } : p.role === 'OWNER' ? {} : { id: '__none__' },
      include: { fridges: { where: { active: true }, select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    const since = new Date(Date.now() - 24 * 3600_000);
    const today = await db.movement.groupBy({
      by: ['type'],
      where: { createdAt: { gte: since }, fridge: scope },
      _count: { _all: true },
    });
    const summary = restaurants.map((r) => {
      const mine = lines.filter((l) => l.restaurantId === r.id);
      return {
        id: r.id,
        name: r.name,
        fridges: r.fridges.length,
        items: mine.length,
        low: mine.filter((l) => l.status === 'LOW').length,
        out: mine.filter((l) => l.status === 'OUT').length,
        expiring: mine.filter((l) => l.expiry === 'EXPIRING').length,
        expired: mine.filter((l) => l.expiry === 'EXPIRED').length,
      };
    });
    return {
      summary,
      reorder,
      expiring,
      last24h: Object.fromEntries(today.map((t) => [t.type, t._count._all])),
    };
  });

  app.get('/movements', manager, async (req) => {
    const q = MovementQuery.parse(req.query);
    const { where } = await movementWhere(req, q);
    const [total, rows] = await Promise.all([
      db.movement.count({ where }),
      db.movement.findMany({
        where,
        include: movementInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
    ]);
    return { total, page: q.page, limit: q.limit, rows };
  });

  app.get('/movements.csv', manager, async (req, reply) => {
    const q = MovementQuery.parse(req.query);
    const { where, tz } = await movementWhere(req, q);
    const rows = await db.movement.findMany({ where, include: movementInclude, orderBy: { createdAt: 'asc' }, take: 50_000 });
    const csv = toCsv([
      ['When', 'Restaurant', 'Fridge', 'Item', 'Category', 'Type', 'Qty', 'Unit', 'Stock after', 'Who', 'Tablet', 'Reason', 'Use-by'],
      ...rows.map((m) => [
        localStamp(m.createdAt, tz),
        m.fridge.restaurant.name,
        m.fridge.name,
        m.item.name,
        m.item.category,
        m.type,
        m.qty,
        m.item.unit,
        m.qtyAfter,
        m.staff.name,
        m.device?.name ?? '',
        m.reason ?? '',
        m.expiresAt ? localDateString(m.expiresAt, tz) : '',
      ]),
    ]);
    return sendCsv(reply, `movements-${localDateString(new Date(), tz)}.csv`, csv);
  });

  /** Taken / wasted / added per item per local day. */
  async function usage(req: Parameters<typeof principalOf>[0]) {
    const p = principalOf(req);
    const q = UsageQuery.parse(req.query);
    if (q.fridgeId) await fridgeInScope(p, q.fridgeId);
    const scope = restaurantFilter(p, q.restaurantId);
    const tz = await tzFor(scope.restaurantId);
    const days = (startOfLocalDay(q.to, tz).getTime() - startOfLocalDay(q.from, tz).getTime()) / 86_400_000;
    if (days > 366) throw badRequest('Choose a range of at most a year');
    const rows = await db.movement.findMany({
      where: {
        fridge: scope,
        ...(q.fridgeId ? { fridgeId: q.fridgeId } : {}),
        type: { in: ['TAKE', 'WASTE', 'ADD'] },
        createdAt: dateRange(q.from, q.to, tz),
      },
      include: { item: { select: { name: true, unit: true, category: true } } },
    });
    const map = new Map<string, { date: string; itemId: string; name: string; category: string; unit: string; taken: number; wasted: number; added: number }>();
    for (const m of rows) {
      const date = localDateString(m.createdAt, tz);
      const key = `${date}|${m.itemId}`;
      const e = map.get(key) ?? { date, itemId: m.itemId, name: m.item.name, category: m.item.category, unit: m.item.unit, taken: 0, wasted: 0, added: 0 };
      if (m.type === 'TAKE') e.taken = round3(e.taken + m.qty);
      if (m.type === 'WASTE') e.wasted = round3(e.wasted + m.qty);
      if (m.type === 'ADD') e.added = round3(e.added + m.qty);
      map.set(key, e);
    }
    const daily = [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    const totals = new Map<string, { itemId: string; name: string; category: string; unit: string; taken: number; wasted: number; added: number }>();
    for (const r of daily) {
      const t = totals.get(r.itemId) ?? { itemId: r.itemId, name: r.name, category: r.category, unit: r.unit, taken: 0, wasted: 0, added: 0 };
      t.taken = round3(t.taken + r.taken);
      t.wasted = round3(t.wasted + r.wasted);
      t.added = round3(t.added + r.added);
      totals.set(r.itemId, t);
    }
    const wasteReasons = new Map<string, number>();
    for (const m of rows) if (m.type === 'WASTE') wasteReasons.set(m.reason ?? 'Unspecified', (wasteReasons.get(m.reason ?? 'Unspecified') ?? 0) + 1);
    return {
      from: q.from,
      to: q.to,
      timezone: tz,
      daily,
      totals: [...totals.values()].sort((a, b) => b.taken + b.wasted - (a.taken + a.wasted)),
      wasteReasons: [...wasteReasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    };
  }

  app.get('/reports/usage', manager, async (req) => usage(req));
  app.get('/reports/usage.csv', manager, async (req, reply) => {
    const u = await usage(req);
    const csv = toCsv([['Date', 'Item', 'Category', 'Unit', 'Taken', 'Wasted', 'Added'], ...u.daily.map((r) => [r.date, r.name, r.category, r.unit, r.taken, r.wasted, r.added])]);
    return sendCsv(reply, `usage-${u.from}-to-${u.to}.csv`, csv);
  });

  /** A manager's count of a fridge: every item whose count differs gets one ADJUST movement, all or nothing. */
  app.post('/stock-counts', manager, async (req) => {
    const p = principalOf(req);
    const b = StockCountBody.parse(req.body);
    const fridge = await fridgeInScope(p, b.fridgeId);
    const ids = [...new Set(b.counts.map((c) => c.itemId))];
    if (ids.length !== b.counts.length) throw badRequest('An item is listed twice');
    const items = await db.item.findMany({ where: { id: { in: ids }, restaurantId: fridge.restaurantId } });
    if (items.length !== ids.length) throw badRequest('An item does not belong to this restaurant');
    const byId = new Map(items.map((i) => [i.id, i]));
    const movements = await runStockTransaction(async (tx) => {
      const out = [];
      // Fixed order keeps locks consistent with other writers.
      for (const c of [...b.counts].sort((x, y) => x.itemId.localeCompare(y.itemId))) {
        const m = await adjustStock(tx, {
          fridgeId: fridge.id,
          item: byId.get(c.itemId)!,
          timezone: fridge.restaurant.timezone,
          actor: { staffId: p.id },
          countedQty: c.countedQty,
          reason: b.reason,
        });
        if (m) out.push(m);
      }
      return out;
    });
    return { adjusted: movements.length, movements };
  });
}
