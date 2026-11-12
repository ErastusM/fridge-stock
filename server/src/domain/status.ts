import { round3 } from './fifo';

export type StockStatus = 'OK' | 'LOW' | 'OUT';
export type ExpiryStatus = 'FRESH' | 'EXPIRING' | 'EXPIRED';

/**
 * OUT at zero; LOW at or below the minimum (a minimum of 0 means "no threshold").
 * reorderQty tops back up to the par level (or the minimum, if par was set lower).
 */
export function stockStatus(qty: number, minQty: number, parLevel: number): { status: StockStatus; reorderQty: number } {
  const status: StockStatus = qty <= 0 ? 'OUT' : minQty > 0 && qty <= minQty ? 'LOW' : 'OK';
  const target = Math.max(parLevel, minQty);
  const reorderQty = status === 'OK' ? 0 : Math.max(0, round3(target - Math.max(qty, 0)));
  return { status, reorderQty };
}

export function expiryStatus(expiresAt: Date, now: Date, expiringHours: number): ExpiryStatus {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return 'EXPIRED';
  if (ms <= expiringHours * 3_600_000) return 'EXPIRING';
  return 'FRESH';
}

const RANK: Record<ExpiryStatus, number> = { FRESH: 0, EXPIRING: 1, EXPIRED: 2 };

/** The worst status among the batches still holding stock (FRESH when there are none). */
export function worstExpiry(statuses: ExpiryStatus[]): ExpiryStatus {
  return statuses.reduce<ExpiryStatus>((w, s) => (RANK[s] > RANK[w] ? s : w), 'FRESH');
}
