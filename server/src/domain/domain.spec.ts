import { describe, expect, it } from 'vitest';
import { consumeFifo, fifoOrder, round3, totalQty } from './fifo';
import { expiryStatus, stockStatus, worstExpiry } from './status';
import { addDays, defaultExpiry, endOfLocalDay, localDateString, parseDateString, startOfLocalDay } from './time';
import { toCsv } from './csv';
import { quantityError } from './quantity';

const d = (s: string) => new Date(s);
const batch = (id: string, qty: number, expires: string, received = '2026-11-01T08:00:00Z') => ({
  id,
  qtyRemaining: qty,
  expiresAt: d(expires),
  receivedAt: d(received),
});

describe('consumeFifo', () => {
  it('takes from the batch that expires first', () => {
    const r = consumeFifo([batch('late', 5, '2026-11-20T00:00:00Z'), batch('early', 5, '2026-11-14T00:00:00Z')], 2);
    expect(r).toMatchObject({ ok: true, deductions: [{ batchId: 'early', qty: 2 }] });
  });

  it('spills over into the next batch', () => {
    const r = consumeFifo([batch('a', 1.5, '2026-11-14T00:00:00Z'), batch('b', 3, '2026-11-15T00:00:00Z')], 2.25);
    expect(r.ok && r.deductions.map((x) => [x.batchId, x.qty])).toEqual([
      ['a', 1.5],
      ['b', 0.75],
    ]);
  });

  it('refuses rather than going negative', () => {
    expect(consumeFifo([batch('a', 1, '2026-11-14T00:00:00Z')], 1.001)).toEqual({ ok: false, available: 1 });
    expect(consumeFifo([], 1)).toEqual({ ok: false, available: 0 });
  });

  it('can take exactly everything, with float noise rounded away', () => {
    const r = consumeFifo([batch('a', 0.1, '2026-11-14T00:00:00Z'), batch('b', 0.2, '2026-11-15T00:00:00Z')], 0.3);
    expect(r.ok).toBe(true);
  });

  it('breaks expiry ties by the oldest delivery, then id', () => {
    const order = fifoOrder([
      batch('z', 1, '2026-11-14T00:00:00Z', '2026-11-02T00:00:00Z'),
      batch('y', 1, '2026-11-14T00:00:00Z', '2026-11-01T00:00:00Z'),
      batch('x', 1, '2026-11-14T00:00:00Z', '2026-11-01T00:00:00Z'),
      batch('empty', 0, '2026-11-01T00:00:00Z'),
    ]);
    expect(order.map((b) => b.id)).toEqual(['x', 'y', 'z']);
  });

  it('rejects a non-positive quantity', () => {
    expect(() => consumeFifo([], 0)).toThrow();
    expect(() => consumeFifo([], -1)).toThrow();
  });

  it('totals and rounds', () => {
    expect(totalQty([{ qtyRemaining: 0.1 }, { qtyRemaining: 0.2 }])).toBe(0.3);
    expect(round3(1.23456)).toBe(1.235);
  });
});

describe('stockStatus', () => {
  it('OUT at zero, LOW at or under the minimum, OK above', () => {
    expect(stockStatus(0, 2, 10)).toEqual({ status: 'OUT', reorderQty: 10 });
    expect(stockStatus(2, 2, 10)).toEqual({ status: 'LOW', reorderQty: 8 });
    expect(stockStatus(3, 2, 10)).toEqual({ status: 'OK', reorderQty: 0 });
  });
  it('a minimum of zero means no low threshold', () => {
    expect(stockStatus(1, 0, 0).status).toBe('OK');
  });
  it('reorders up to the minimum when par was set lower', () => {
    expect(stockStatus(1, 5, 0)).toEqual({ status: 'LOW', reorderQty: 4 });
  });
});

describe('expiryStatus', () => {
  const now = d('2026-11-12T10:00:00Z');
  it('classifies', () => {
    expect(expiryStatus(d('2026-11-12T09:59:59Z'), now, 48)).toBe('EXPIRED');
    expect(expiryStatus(now, now, 48)).toBe('EXPIRED');
    expect(expiryStatus(d('2026-11-14T10:00:00Z'), now, 48)).toBe('EXPIRING');
    expect(expiryStatus(d('2026-11-14T10:00:01Z'), now, 48)).toBe('FRESH');
  });
  it('worst wins', () => {
    expect(worstExpiry([])).toBe('FRESH');
    expect(worstExpiry(['FRESH', 'EXPIRED', 'EXPIRING'])).toBe('EXPIRED');
  });
});

describe('local time (Africa/Windhoek, UTC+2)', () => {
  const tz = 'Africa/Windhoek';
  it('a use-by date ends at 23:59:59 local', () => {
    expect(endOfLocalDay('2026-11-12', tz).toISOString()).toBe('2026-11-12T21:59:59.000Z');
    expect(startOfLocalDay('2026-11-12', tz).toISOString()).toBe('2026-11-11T22:00:00.000Z');
  });
  it('"today" is local: 23:30 UTC is already tomorrow in Swakopmund', () => {
    expect(localDateString(d('2026-11-12T23:30:00Z'), tz)).toBe('2026-11-13');
  });
  it('default expiry is today + shelf life, end of day', () => {
    expect(defaultExpiry(d('2026-11-12T10:00:00Z'), 3, tz).toISOString()).toBe('2026-11-15T21:59:59.000Z');
  });
  it('handles month ends and rejects impossible dates', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(parseDateString('2026-02-30')).toBeNull();
    expect(parseDateString('12/11/2026')).toBeNull();
  });
  it('works in a zone with daylight saving too', () => {
    expect(endOfLocalDay('2026-07-01', 'Europe/Berlin').toISOString()).toBe('2026-07-01T21:59:59.000Z');
    expect(endOfLocalDay('2026-01-01', 'Europe/Berlin').toISOString()).toBe('2026-01-01T22:59:59.000Z');
  });
});

describe('toCsv', () => {
  it('quotes and neutralises formulas', () => {
    expect(toCsv([['a,b', 'say "hi"', 3, null], ['=1+1', '-2', -2]])).toBe('"a,b","say ""hi""",3,\r\n\'=1+1,\'-2,-2\r\n');
  });
});

describe('quantityError', () => {
  it('whole numbers for counted units, 3 decimals for weights', () => {
    expect(quantityError(2, 'EACH')).toBeNull();
    expect(quantityError(1.5, 'EACH')).toMatch(/whole/);
    expect(quantityError(1.25, 'KG')).toBeNull();
    expect(quantityError(1.2345, 'KG')).toMatch(/decimal/);
    expect(quantityError(0, 'KG')).toMatch(/more than zero/);
    expect(quantityError(0, 'KG', { allowZero: true })).toBeNull();
    expect(quantityError(-1, 'KG', { allowZero: true })).toMatch(/negative/);
  });
});
