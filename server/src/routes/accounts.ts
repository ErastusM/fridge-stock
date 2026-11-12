import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';
import { db } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { fridgeInScope, Principal, principalOf, requireRole, restaurantFilter } from '../principal';
import { balances, ledger } from '../services/accounts';
import { addStock, removeStock } from '../services/stock';
import { endOfLocalDay, localDateString, parseDateString, startOfLocalDay } from '../domain/time';
import { formatCents, periodMonthFor, statementPeriod, statementTotals } from '../domain/money';
import { toCsv } from '../domain/csv';

const manager = { preHandler: requireRole('MANAGER') };
const dateStr = z.string().refine((s) => parseDateString(s) !== null, 'Use a yyyy-mm-dd date');

/** Statements and payments belong to one restaurant: an owner must name it, a manager has theirs. */
async function oneRestaurant(p: Principal, requested?: string) {
  let id: string | null | undefined = requested;
  if (requested) restaurantFilter(p, requested); // throws 404 outside the principal's scope
  else if (p.role !== 'OWNER') id = p.restaurantId;
  else {
    const all = await db.restaurant.findMany({ select: { id: true } });
    if (all.length !== 1) throw badRequest('Choose a restaurant');
    id = all[0].id;
  }
  const r = id ? await db.restaurant.findUnique({ where: { id } }) : null;
  if (!r) throw notFound('Restaurant not found');
  return r;
}

/** People who can hold an account at this restaurant: its staff, plus owners. */
async function accountHolder(restaurantId: string, staffId: string) {
  const s = await db.staff.findFirst({ where: { id: staffId, OR: [{ restaurantId }, { role: 'OWNER' }] } });
  if (!s) throw notFound('Person not found');
  return s;
}

const PaymentBody = z.object({
  restaurantId: z.string().optional(),
  staffId: z.string(),
  amountCents: z.number().int().min(1, 'Amount must be more than zero').max(100_000_000),
  method: z.nativeEnum(PaymentMethod).default('CASH'),
  paidOn: dateStr,
  reference: z.string().trim().max(120).optional(),
});

const RecordBody = z.object({
  fridgeId: z.string(),
  itemId: z.string(),
  type: z.enum(['ADD', 'TAKE', 'WASTE']),
  qty: z.number(),
  /** Who took it (TAKE). Defaults to the manager entering it. */
  staffId: z.string().optional(),
  expiresOn: dateStr.optional(),
  reason: z.string().max(200).optional(),
  supplier: z.string().max(120).optional(),
});

export async function accountRoutes(app: FastifyInstance) {
  /** Everyone's balance at a restaurant, highest owed first. */
  app.get('/accounts', manager, async (req) => {
    const p = principalOf(req);
    const q = z.object({ restaurantId: z.string().optional() }).parse(req.query);
    const r = await oneRestaurant(p, q.restaurantId);
    const [people, bal] = await Promise.all([
      db.staff.findMany({ where: { OR: [{ restaurantId: r.id }, { role: 'OWNER' }] }, orderBy: { name: 'asc' } }),
      balances(r.id, r.timezone),
    ]);
    const month = periodMonthFor(localDateString(new Date(), r.timezone), r.statementStartDay);
    const rows = people
      .map((s) => ({ staffId: s.id, name: s.name, role: s.role, active: s.active, ...(bal.get(s.id) ?? { balanceCents: 0, lastChargeOn: null, lastPaymentOn: null }) }))
      .filter((x) => x.active || x.balanceCents !== 0)
      .sort((a, b) => b.balanceCents - a.balanceCents || a.name.localeCompare(b.name));
    return {
      restaurant: { id: r.id, name: r.name, timezone: r.timezone, statementStartDay: r.statementStartDay },
      currentPeriod: { month, ...statementPeriod(month, r.statementStartDay) },
      totalOwedCents: rows.reduce((s, x) => s + Math.max(0, x.balanceCents), 0),
      rows,
    };
  });

  app.get('/payments', manager, async (req) => {
    const p = principalOf(req);
    const q = z.object({ restaurantId: z.string().optional(), staffId: z.string().optional(), from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
    const r = await oneRestaurant(p, q.restaurantId);
    return db.payment.findMany({
      where: {
        restaurantId: r.id,
        ...(q.staffId ? { staffId: q.staffId } : {}),
        ...(q.from || q.to
          ? { paidOn: { ...(q.from ? { gte: startOfLocalDay(q.from, r.timezone) } : {}), ...(q.to ? { lte: endOfLocalDay(q.to, r.timezone) } : {}) } }
          : {}),
      },
      include: { staff: { select: { name: true } }, recordedBy: { select: { name: true } } },
      orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  });

  app.post('/payments', manager, async (req) => {
    const p = principalOf(req);
    const b = PaymentBody.parse(req.body);
    const r = await oneRestaurant(p, b.restaurantId);
    await accountHolder(r.id, b.staffId);
    // Stored as midday local time so the calendar day is unambiguous in any zone maths.
    const paidOn = new Date(startOfLocalDay(b.paidOn, r.timezone).getTime() + 12 * 3600_000);
    if (paidOn.getTime() > Date.now() + 36 * 3600_000) throw badRequest('A payment cannot be dated in the future');
    return db.payment.create({
      data: { restaurantId: r.id, staffId: b.staffId, amountCents: b.amountCents, method: b.method, paidOn, reference: b.reference || null, recordedById: p.id },
    });
  });

  app.post('/payments/:id/void', manager, async (req) => {
    const p = principalOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3, 'Say why it is being voided').max(200) }).parse(req.body);
    const pay = await db.payment.findFirst({ where: { id, ...(p.role === 'OWNER' ? {} : { restaurantId: p.restaurantId ?? '__none__' }) } });
    if (!pay) throw notFound('Payment not found');
    const done = await db.payment.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: new Date(), voidedById: p.id, voidReason: reason } });
    if (done.count !== 1) throw conflict('That payment is already voided');
    return { ok: true };
  });

  /** Statement(s) for the period that ends in `month` (16th–15th by default). */
  async function statements(req: Parameters<typeof principalOf>[0]) {
    const p = principalOf(req);
    const q = z.object({ restaurantId: z.string().optional(), month: z.string().regex(/^\d{4}-\d{2}$/, 'Use yyyy-mm'), staffId: z.string().optional() }).parse(req.query);
    const r = await oneRestaurant(p, q.restaurantId);
    const { from, to } = statementPeriod(q.month, r.statementStartDay);
    if (q.staffId) await accountHolder(r.id, q.staffId);
    const map = await ledger(r.id, r.timezone, q.staffId ? [q.staffId] : undefined);
    const people = await db.staff.findMany({ where: { id: { in: q.staffId ? [q.staffId] : [...map.keys()] } } });
    const list = people
      .map((s) => {
        const l = map.get(s.id) ?? { charges: [], payments: [] };
        const t = statementTotals(l.charges, l.payments, from, to);
        return {
          staff: { id: s.id, name: s.name, role: s.role, active: s.active },
          ...t,
          lines: l.charges
            .filter((c) => c.date >= from && c.date <= to)
            .map((c) => ({ date: c.date, at: c.m.createdAt, item: c.m.item.name, unit: c.m.item.unit, fridge: c.m.fridge.name, qty: c.m.qty, unitPriceCents: c.m.unitPriceCents, amountCents: c.amountCents })),
          payments: l.payments
            .filter((x) => x.date >= from && x.date <= to)
            .map((x) => ({ date: x.date, method: x.p.method, reference: x.p.reference, amountCents: x.amountCents })),
        };
      })
      // Nobody gets a blank statement: something happened in the period or something is owed.
      .filter((s) => q.staffId || s.lines.length || s.payments.length || s.closingCents !== 0)
      .sort((a, b) => a.staff.name.localeCompare(b.staff.name));
    return {
      restaurant: { id: r.id, name: r.name, timezone: r.timezone },
      period: { month: q.month, from, to, startDay: r.statementStartDay },
      generatedAt: new Date().toISOString(),
      statements: list,
      totals: {
        purchasesCents: list.reduce((s, x) => s + x.purchasesCents, 0),
        paidCents: list.reduce((s, x) => s + x.paidCents, 0),
        closingCents: list.reduce((s, x) => s + x.closingCents, 0),
      },
    };
  }

  app.get('/statements', manager, async (req) => statements(req));
  app.get('/statements.csv', manager, async (req, reply) => {
    const s = await statements(req);
    const csv = toCsv([
      ['Person', 'Period from', 'Period to', 'Opening balance', 'Purchases', 'Payments', 'Balance due'],
      ...s.statements.map((x) => [x.staff.name, s.period.from, s.period.to, formatCents(x.openingCents), formatCents(x.purchasesCents), formatCents(x.paidCents), formatCents(x.closingCents)]),
    ]);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="statements-${s.period.from}-to-${s.period.to}.csv"`)
      .send('﻿' + csv);
  });

  /** The manage app's own entry: receive a delivery, or record a take or waste for someone. */
  app.post('/movements', manager, async (req) => {
    const p = principalOf(req);
    const b = RecordBody.parse(req.body);
    const fridge = await fridgeInScope(p, b.fridgeId);
    const fi = await db.fridgeItem.findUnique({ where: { fridgeId_itemId: { fridgeId: fridge.id, itemId: b.itemId } }, include: { item: true } });
    if (!fi || !fi.item.active) throw notFound('This item is not kept in this fridge');
    const who = b.staffId ? await accountHolder(fridge.restaurantId, b.staffId) : null;
    if (who && !who.active) throw badRequest('That person is no longer active');
    const base = {
      fridgeId: fridge.id,
      item: fi.item,
      timezone: fridge.restaurant.timezone,
      actor: { staffId: who?.id ?? p.id, recordedById: p.id },
    };
    if (b.type === 'ADD') {
      const expiresAt = b.expiresOn ? endOfLocalDay(b.expiresOn, fridge.restaurant.timezone) : null;
      return { movement: await addStock({ ...base, qty: b.qty, expiresAt, reason: b.reason, supplier: b.supplier }) };
    }
    return { movement: await removeStock({ ...base, qty: b.qty, type: b.type, reason: b.reason }) };
  });
}
