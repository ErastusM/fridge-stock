import { round3 } from './fifo';

export type UnitName = 'EACH' | 'KG' | 'L' | 'PORTION' | 'PACK';

const COUNTED: UnitName[] = ['EACH', 'PORTION', 'PACK'];
export const MAX_QTY = 100_000;

/** Returns an error message, or null when the quantity is acceptable for the unit. */
export function quantityError(qty: number, unit: UnitName, { allowZero = false } = {}): string | null {
  if (!Number.isFinite(qty)) return 'Quantity must be a number';
  if (qty < 0 || (!allowZero && qty === 0)) return allowZero ? 'Quantity cannot be negative' : 'Quantity must be more than zero';
  if (qty > MAX_QTY) return `Quantity cannot exceed ${MAX_QTY}`;
  if (round3(qty) !== qty) return 'Use at most 3 decimal places';
  if (COUNTED.includes(unit) && !Number.isInteger(qty)) return `${unit.toLowerCase()} must be a whole number`;
  return null;
}
