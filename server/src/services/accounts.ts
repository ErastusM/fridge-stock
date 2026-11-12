import { db } from '../db';
import { ChargeLine, PaymentLine, statementTotals } from '../domain/money';
import { addDays, localDateString } from '../domain/time';

/**
 * A person's fridge account at one restaurant: every charged TAKE there, minus every payment
 * (not voided) recorded there. Positive balance = they owe.
 */
export async function ledger(restaurantId: string, timezone: string, staffIds?: string[]) {
  const [charges, payments] = await Promise.all([
    db.movement.findMany({
      where: { type: 'TAKE', amountCents: { not: null }, fridge: { restaurantId }, ...(staffIds ? { staffId: { in: staffIds } } : {}) },
      include: { item: { select: { name: true, unit: true } }, fridge: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.payment.findMany({
      where: { restaurantId, voidedAt: null, ...(staffIds ? { staffId: { in: staffIds } } : {}) },
      orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  const byStaff = new Map<string, { charges: (ChargeLine & { m: (typeof charges)[number] })[]; payments: (PaymentLine & { p: (typeof payments)[number] })[] }>();
  const get = (id: string) => {
    let e = byStaff.get(id);
    if (!e) byStaff.set(id, (e = { charges: [], payments: [] }));
    return e;
  };
  for (const m of charges) get(m.staffId).charges.push({ date: localDateString(m.createdAt, timezone), amountCents: m.amountCents!, m });
  for (const p of payments) get(p.staffId).payments.push({ date: localDateString(p.paidOn, timezone), amountCents: p.amountCents, p });
  return byStaff;
}

export async function balances(restaurantId: string, timezone: string) {
  const today = localDateString(new Date(), timezone);
  const map = await ledger(restaurantId, timezone);
  const out = new Map<string, { balanceCents: number; lastChargeOn: string | null; lastPaymentOn: string | null }>();
  for (const [staffId, l] of map) {
    const t = statementTotals(l.charges, l.payments, addDays(today, 1), addDays(today, 1));
    out.set(staffId, {
      balanceCents: t.openingCents,
      lastChargeOn: l.charges.at(-1)?.date ?? null,
      lastPaymentOn: l.payments.at(-1)?.date ?? null,
    });
  }
  return out;
}
