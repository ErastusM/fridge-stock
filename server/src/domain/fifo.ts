/** Quantities are kept to 3 decimals (grams / millilitres); every sum is re-rounded. */
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface BatchLike {
  id: string;
  qtyRemaining: number;
  expiresAt: Date;
  receivedAt: Date;
}

export interface Deduction {
  batchId: string;
  qty: number;
  expiresAt: Date;
}

export type FifoResult =
  | { ok: true; deductions: Deduction[]; available: number }
  | { ok: false; available: number };

export function totalQty(batches: Pick<BatchLike, 'qtyRemaining'>[]): number {
  return round3(batches.reduce((s, b) => s + Math.max(0, b.qtyRemaining), 0));
}

/** Earliest use-by first; ties broken by the oldest delivery, then id (deterministic). */
export function fifoOrder<T extends BatchLike>(batches: T[]): T[] {
  return [...batches]
    .filter((b) => b.qtyRemaining > 0)
    .sort(
      (a, b) =>
        a.expiresAt.getTime() - b.expiresAt.getTime() ||
        a.receivedAt.getTime() - b.receivedAt.getTime() ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Decide which batches a take/waste draws from: the one that expires first, first.
 * Refuses (ok: false) when the fridge holds less than asked — stock never goes negative;
 * a real shortfall is corrected with a stock count, not hidden.
 */
export function consumeFifo(batches: BatchLike[], qty: number): FifoResult {
  if (!(qty > 0) || !Number.isFinite(qty)) throw new Error('qty must be a positive number');
  const wanted = round3(qty);
  const available = totalQty(batches);
  if (available < wanted) return { ok: false, available };

  const deductions: Deduction[] = [];
  let left = wanted;
  for (const b of fifoOrder(batches)) {
    if (left <= 0) break;
    const take = round3(Math.min(b.qtyRemaining, left));
    if (take <= 0) continue;
    deductions.push({ batchId: b.id, qty: take, expiresAt: b.expiresAt });
    left = round3(left - take);
  }
  return { ok: true, deductions, available };
}
