import { describe, expect, it } from 'vitest';
import { balanceAt, chargeFor, formatCents, parseMoney, periodMonthFor, statementPeriod, statementTotals } from './money';

describe('money', () => {
  it('formats cents as Namibian dollars', () => {
    expect(formatCents(1300)).toBe('N$13.00');
    expect(formatCents(5)).toBe('N$0.05');
    expect(formatCents(123456)).toBe('N$1,234.56');
    expect(formatCents(-250)).toBe('-N$2.50');
  });
  it('charges qty × price to the cent, half up', () => {
    expect(chargeFor(2, 1300)).toBe(2600);
    expect(chargeFor(0.333, 1000)).toBe(333);
    expect(chargeFor(0.5, 1)).toBe(1);
  });
  it('parses typed amounts', () => {
    expect(parseMoney('13')).toBe(1300);
    expect(parseMoney('13.5')).toBe(1350);
    expect(parseMoney('N$ 13,50')).toBe(1350);
    expect(parseMoney('13.505')).toBeNull();
    expect(parseMoney('-1')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('statement periods', () => {
  it('16th to 15th, inclusive, crossing the year', () => {
    expect(statementPeriod('2026-11', 16)).toEqual({ from: '2026-10-16', to: '2026-11-15' });
    expect(statementPeriod('2026-01', 16)).toEqual({ from: '2025-12-16', to: '2026-01-15' });
  });
  it('start day 1 is the calendar month', () => {
    expect(statementPeriod('2028-02', 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('rejects nonsense', () => {
    expect(() => statementPeriod('2026-13', 16)).toThrow();
    expect(() => statementPeriod('2026-11', 31)).toThrow();
  });
  it('knows which period a day falls in', () => {
    expect(periodMonthFor('2026-11-15', 16)).toBe('2026-11');
    expect(periodMonthFor('2026-11-16', 16)).toBe('2026-12');
    expect(periodMonthFor('2026-12-20', 16)).toBe('2027-01');
    expect(periodMonthFor('2026-11-30', 1)).toBe('2026-11');
  });
});

describe('statement totals', () => {
  const charges = [
    { date: '2026-10-10', amountCents: 1000 }, // before
    { date: '2026-10-16', amountCents: 1300 }, // first day
    { date: '2026-11-15', amountCents: 2500 }, // last day
    { date: '2026-11-16', amountCents: 9900 }, // after
  ];
  const payments = [
    { date: '2026-10-12', amountCents: 400 },
    { date: '2026-11-01', amountCents: 2000 },
  ];
  it('opening, purchases, payments, closing', () => {
    expect(statementTotals(charges, payments, '2026-10-16', '2026-11-15')).toEqual({
      openingCents: 600,
      purchasesCents: 3800,
      paidCents: 2000,
      closingCents: 2400,
    });
  });
  it('balance on a day includes that day', () => {
    expect(balanceAt(charges, payments, '2026-11-15')).toBe(2400);
    expect(balanceAt(charges, payments, '2026-11-16')).toBe(12300);
  });
});
