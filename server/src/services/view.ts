import { db } from '../db';
import { config } from '../config';
import { round3, totalQty, fifoOrder } from '../domain/fifo';
import { expiryStatus, ExpiryStatus, stockStatus, StockStatus, worstExpiry } from '../domain/status';

export interface StockLine {
  fridgeId: string;
  fridgeName: string;
  restaurantId: string;
  restaurantName: string;
  itemId: string;
  name: string;
  category: string;
  unit: string;
  defaultShelfLifeDays: number;
  qty: number;
  minQty: number;
  parLevel: number;
  status: StockStatus;
  reorderQty: number;
  expiry: ExpiryStatus;
  nextExpiry: string | null;
  batches: { id: string; qty: number; expiresAt: string; receivedAt: string; expiry: ExpiryStatus }[];
}

/** Current stock of every item assigned to the given fridges, with stock and expiry statuses. */
export async function stockLines(where: { fridgeIds?: string[]; restaurantId?: string }, now = new Date()): Promise<StockLine[]> {
  const rows = await db.fridgeItem.findMany({
    where: {
      ...(where.fridgeIds ? { fridgeId: { in: where.fridgeIds } } : {}),
      fridge: { active: true, ...(where.restaurantId ? { restaurantId: where.restaurantId } : {}) },
      item: { active: true },
    },
    include: { item: true, fridge: { include: { restaurant: true } } },
  });
  if (rows.length === 0) return [];
  const batches = await db.batch.findMany({
    where: { qtyRemaining: { gt: 0 }, fridgeId: { in: [...new Set(rows.map((r) => r.fridgeId))] } },
  });
  const byKey = new Map<string, typeof batches>();
  for (const b of batches) {
    const k = `${b.fridgeId}|${b.itemId}`;
    byKey.set(k, [...(byKey.get(k) ?? []), b]);
  }
  return rows
    .map((r) => {
      const bs = fifoOrder(byKey.get(`${r.fridgeId}|${r.itemId}`) ?? []);
      const qty = totalQty(bs);
      const { status, reorderQty } = stockStatus(qty, r.minQty, r.parLevel);
      const bview = bs.map((b) => ({
        id: b.id,
        qty: round3(b.qtyRemaining),
        expiresAt: b.expiresAt.toISOString(),
        receivedAt: b.receivedAt.toISOString(),
        expiry: expiryStatus(b.expiresAt, now, config.expiringHours),
      }));
      return {
        fridgeId: r.fridgeId,
        fridgeName: r.fridge.name,
        restaurantId: r.fridge.restaurantId,
        restaurantName: r.fridge.restaurant.name,
        itemId: r.itemId,
        name: r.item.name,
        category: r.item.category,
        unit: r.item.unit,
        defaultShelfLifeDays: r.item.defaultShelfLifeDays,
        qty,
        minQty: r.minQty,
        parLevel: r.parLevel,
        status,
        reorderQty,
        expiry: worstExpiry(bview.map((b) => b.expiry)),
        nextExpiry: bview[0]?.expiresAt ?? null,
        batches: bview,
      };
    })
    .sort((a, b) => a.fridgeName.localeCompare(b.fridgeName) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
