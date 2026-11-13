import { describe, expect, it } from 'vitest';
import {
  addItem,
  addPerson,
  emptyData,
  formatMoney,
  monthReport,
  parseData,
  parseMoney,
  periodFor,
  periodKeyOf,
  recordCount,
  recordRestock,
  recordTake,
  reportCsv,
  RuleError,
  shiftKey,
  stockState,
  toCsv,
  updateItem,
  voidEntry,
  type Data,
} from './model';

const now = new Date(2026, 10, 13, 12, 0); // 13 Nov 2026, local

function setup(): Data {
  let d = emptyData();
  d = addPerson(d, 'Erastus');
  d = addPerson(d, 'Maria');
  d = addItem(d, { name: 'Coke', priceCents: 1500, stock: 10, lowAt: 3 });
  d = addItem(d, { name: 'Water', priceCents: 1000, stock: 5 });
  d = addItem(d, { name: 'Milk', priceCents: null, stock: 2 });
  return d;
}
const id = (d: Data, name: string) => (d.items.find((i) => i.name === name) ?? d.people.find((p) => p.name === name))!.id;

describe('recording a take', () => {
  it('logs who took what at the price of the day, and stock goes down', () => {
    let d = setup();
    d = recordTake(d, { personId: id(d, 'Erastus'), lines: [{ itemId: id(d, 'Coke'), qty: 2 }], at: now, now }).data;
    expect(d.items.find((i) => i.name === 'Coke')!.stock).toBe(8);
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ kind: 'TAKE', qty: 2, unitPriceCents: 1500, personId: id(d, 'Erastus') });
  });

  it('saves several items as one group', () => {
    let d = setup();
    const r = recordTake(d, {
      personId: id(d, 'Maria'),
      lines: [
        { itemId: id(d, 'Coke'), qty: 1 },
        { itemId: id(d, 'Water'), qty: 2 },
        { itemId: id(d, 'Milk'), qty: 0 },
      ],
      at: now,
      now,
    });
    d = r.data;
    expect(d.entries).toHaveLength(2);
    expect(new Set(d.entries.map((e) => e.groupId))).toEqual(new Set([r.groupId]));
  });

  it('refuses no person, nothing chosen, fractions and the future', () => {
    const d = setup();
    const coke = id(d, 'Coke');
    expect(() => recordTake(d, { personId: 'x', lines: [{ itemId: coke, qty: 1 }], at: now, now })).toThrow(RuleError);
    expect(() => recordTake(d, { personId: id(d, 'Maria'), lines: [], at: now, now })).toThrow('at least one');
    expect(() => recordTake(d, { personId: id(d, 'Maria'), lines: [{ itemId: coke, qty: 1.5 }], at: now, now })).toThrow('whole');
    const later = new Date(now.getTime() + 3_600_000);
    expect(() => recordTake(d, { personId: id(d, 'Maria'), lines: [{ itemId: coke, qty: 1 }], at: later, now })).toThrow('future');
  });

  it('a later price change does not change a past take', () => {
    let d = setup();
    d = recordTake(d, { personId: id(d, 'Erastus'), lines: [{ itemId: id(d, 'Coke'), qty: 1 }], at: now, now }).data;
    d = updateItem(d, id(d, 'Coke'), { priceCents: 2000 });
    expect(monthReport(d, '2026-11').amountCents).toBe(1500);
  });
});

describe('undo', () => {
  it('voids the entry, keeps it in the log and puts the stock back', () => {
    let d = setup();
    d = recordTake(d, { personId: id(d, 'Erastus'), lines: [{ itemId: id(d, 'Coke'), qty: 3 }], at: now, now }).data;
    d = voidEntry(d, { entryId: d.entries[0].id, reason: 'wrong person', now });
    expect(d.entries[0].voided?.reason).toBe('wrong person');
    expect(d.items.find((i) => i.name === 'Coke')!.stock).toBe(10);
    expect(monthReport(d, '2026-11').qty).toBe(0);
    expect(() => voidEntry(d, { entryId: d.entries[0].id, reason: 'again', now })).toThrow('already');
  });

  it('can undo a whole save, and needs a reason', () => {
    let d = setup();
    d = recordTake(d, {
      personId: id(d, 'Maria'),
      lines: [
        { itemId: id(d, 'Coke'), qty: 1 },
        { itemId: id(d, 'Water'), qty: 1 },
      ],
      at: now,
      now,
    }).data;
    expect(() => voidEntry(d, { entryId: d.entries[0].id, reason: ' ', now })).toThrow('why');
    d = voidEntry(d, { entryId: d.entries[0].id, reason: 'mistake', now, wholeGroup: true });
    expect(d.entries.every((e) => e.voided)).toBe(true);
    expect(d.items.map((i) => i.stock)).toEqual([10, 5, 2]);
  });
});

describe('stock', () => {
  it('restock adds, a count sets the real number and logs the difference', () => {
    let d = setup();
    const coke = id(d, 'Coke');
    d = recordRestock(d, { itemId: coke, qty: 12, now });
    expect(d.items[0].stock).toBe(22);
    d = recordCount(d, { itemId: coke, counted: 20, now, note: 'counted Friday' });
    expect(d.items[0].stock).toBe(20);
    expect(d.entries.at(-1)).toMatchObject({ kind: 'COUNT', qty: -2 });
    expect(recordCount(d, { itemId: coke, counted: 20, now })).toBe(d);
  });

  it('flags low and out', () => {
    let d = setup();
    expect(stockState(d.items[0])).toBe('OK');
    d = recordTake(d, { personId: id(d, 'Erastus'), lines: [{ itemId: id(d, 'Coke'), qty: 7 }], at: now, now }).data;
    expect(stockState(d.items[0])).toBe('LOW');
    d = recordTake(d, { personId: id(d, 'Erastus'), lines: [{ itemId: id(d, 'Coke'), qty: 4 }], at: now, now }).data;
    expect(d.items[0].stock).toBe(-1);
    expect(stockState(d.items[0])).toBe('OUT');
  });

  it('refuses duplicate names', () => {
    const d = setup();
    expect(() => addPerson(d, ' erastus ')).toThrow('already');
    expect(() => addItem(d, { name: 'COKE', priceCents: 1 })).toThrow('already');
  });
});

describe('months', () => {
  it('calendar month by default', () => {
    const p = periodFor('2026-11', 1);
    expect(p.start).toEqual(new Date(2026, 10, 1));
    expect(p.end).toEqual(new Date(2026, 11, 1));
    expect(periodKeyOf(new Date(2026, 10, 30, 23, 59), 1)).toBe('2026-11');
  });

  it('16th-to-15th months are named after the month they end in', () => {
    const p = periodFor('2026-01', 16);
    expect(p.start).toEqual(new Date(2025, 11, 16));
    expect(p.end).toEqual(new Date(2026, 0, 16));
    expect(periodKeyOf(new Date(2026, 11, 20), 16)).toBe('2027-01');
    expect(periodKeyOf(new Date(2026, 11, 15), 16)).toBe('2026-12');
    expect(shiftKey('2026-01', -1)).toBe('2025-12');
  });

  it('the report totals per person and per item, inside the month only', () => {
    let d = setup();
    const take = (p: string, i: string, q: number, at: Date) =>
      (d = recordTake(d, { personId: id(d, p), lines: [{ itemId: id(d, i), qty: q }], at, now }).data);
    take('Erastus', 'Coke', 2, new Date(2026, 10, 2));
    take('Erastus', 'Coke', 1, new Date(2026, 10, 9));
    take('Erastus', 'Milk', 1, new Date(2026, 10, 9));
    take('Maria', 'Water', 1, new Date(2026, 10, 10));
    take('Maria', 'Water', 4, new Date(2026, 9, 31, 23, 59)); // October
    const r = monthReport(d, '2026-11');
    expect(r.people.map((p) => [p.name, p.qty, p.amountCents])).toEqual([
      ['Erastus', 4, 4500],
      ['Maria', 1, 1000],
    ]);
    expect(r.people[0].lines.map((l) => [l.itemName, l.qty])).toEqual([
      ['Coke', 3],
      ['Milk', 1],
    ]);
    expect(r.items[0]).toMatchObject({ itemName: 'Coke', qty: 3, amountCents: 4500 });
    expect(r.amountCents).toBe(5500);
    expect(reportCsv(r)).toContain('Erastus,TOTAL,4,45.00');
  });
});

describe('money, CSV and backups', () => {
  it('formats and parses Namibian dollars', () => {
    expect(formatMoney(150050)).toBe('N$ 1 500.50');
    expect(parseMoney('15')).toBe(1500);
    expect(parseMoney('N$ 15,5')).toBe(1550);
    expect(parseMoney('')).toBeNull();
    expect(() => parseMoney('abc')).toThrow(RuleError);
  });

  it('quotes CSV cells and defuses formulas', () => {
    expect(toCsv([['a,b', '=1+1', 3]])).toBe('"a,b",\'=1+1,3\r\n');
  });

  it('restores a backup and refuses a wrong file', () => {
    const d = setup();
    expect(parseData(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(() => parseData({ hello: 1 })).toThrow('not a fridge backup');
  });
});
