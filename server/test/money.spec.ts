import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { db } from '../src/db';
import { as, kiosk, login, world } from './fixtures';
import { localDateString } from '../src/domain/time';
import { periodMonthFor } from '../src/domain/money';

let app: FastifyInstance;
let w: Awaited<ReturnType<typeof world>>;
const today = () => localDateString(new Date(), 'Africa/Windhoek');

beforeAll(async () => {
  app = await buildApp({ logger: false });
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
beforeEach(async () => {
  w = await world();
  await kiosk(app, w.a.barToken).move({ type: 'ADD', itemId: w.a.beer.id, qty: 24, pin: w.a.managerPin });
});

describe('charging takes', () => {
  it('a priced take is charged to the person, and they are told their balance', async () => {
    const r = await kiosk(app, w.a.barToken).move({ type: 'TAKE', itemId: w.a.beer.id, qty: 2, pin: w.a.cookPin });
    expect(r.json()).toMatchObject({ movement: { unitPriceCents: 1300, amountCents: 2600 }, account: { chargedCents: 2600, balanceCents: 2600 } });
    const r2 = await kiosk(app, w.a.barToken).move({ type: 'TAKE', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin });
    expect(r2.json().account).toEqual({ chargedCents: 1300, balanceCents: 3900 });
  });

  it('a later price change does not rewrite what was charged', async () => {
    await kiosk(app, w.a.barToken).move({ type: 'TAKE', itemId: w.a.beer.id, qty: 2, pin: w.a.cookPin });
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    expect((await mgr.patch(`/api/items/${w.a.beer.id}`, { priceCents: 2000 })).statusCode).toBe(200);
    await kiosk(app, w.a.barToken).move({ type: 'TAKE', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin });
    const acc = (await mgr.get('/api/accounts')).json();
    expect(acc.rows.find((r: { name: string }) => r.name === 'Cook A').balanceCents).toBe(2600 + 2000);
  });

  it('waste and unpriced items are not charged to anyone', async () => {
    const waste = await kiosk(app, w.a.barToken).move({ type: 'WASTE', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin, reason: 'Dropped' });
    expect(waste.json()).toMatchObject({ movement: { amountCents: null }, account: null });
    await kiosk(app, w.a.walkInToken).move({ type: 'ADD', itemId: w.a.chicken.id, qty: 2, pin: w.a.cookPin });
    const take = await kiosk(app, w.a.walkInToken).move({ type: 'TAKE', itemId: w.a.chicken.id, qty: 1, pin: w.a.cookPin });
    expect(take.json().account).toBeNull();
  });
});

describe('payments and statements', () => {
  it('payments reduce the balance; a voided payment stops counting but stays on record', async () => {
    await kiosk(app, w.a.barToken).move({ type: 'TAKE', itemId: w.a.beer.id, qty: 4, pin: w.a.cookPin }); // 5200
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    const pay = await mgr.post('/api/payments', { staffId: w.a.cook.id, amountCents: 2000, method: 'CASH', paidOn: today() });
    expect(pay.statusCode).toBe(200);
    const typo = await mgr.post('/api/payments', { staffId: w.a.cook.id, amountCents: 99900, method: 'EFT', paidOn: today(), reference: 'typo' });
    const cookRow = async () => (await mgr.get('/api/accounts')).json().rows.find((r: { name: string }) => r.name === 'Cook A');
    expect(await cookRow()).toMatchObject({ balanceCents: 5200 - 2000 - 99900 }); // in credit
    expect((await mgr.post(`/api/payments/${typo.json().id}/void`, { reason: 'Entered wrong amount' })).statusCode).toBe(200);
    expect((await mgr.post(`/api/payments/${typo.json().id}/void`, { reason: 'again' })).statusCode).toBe(409);
    expect(await cookRow()).toMatchObject({ balanceCents: 3200 });
    const list = (await mgr.get(`/api/payments?staffId=${w.a.cook.id}`)).json();
    expect(list).toHaveLength(2);
    expect(list.find((p: { reference: string }) => p.reference === 'typo').voidReason).toBe('Entered wrong amount');
  });

  it('refuses a zero, negative or future payment', async () => {
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    expect((await mgr.post('/api/payments', { staffId: w.a.cook.id, amountCents: 0, paidOn: today() })).statusCode).toBe(400);
    expect((await mgr.post('/api/payments', { staffId: w.a.cook.id, amountCents: -5, paidOn: today() })).statusCode).toBe(400);
    expect((await mgr.post('/api/payments', { staffId: w.a.cook.id, amountCents: 100, paidOn: '2099-01-01' })).statusCode).toBe(400);
  });

  it('the statement for the current period lists the takes and payments and the balance due', async () => {
    await kiosk(app, w.a.barToken).move({ type: 'TAKE', itemId: w.a.beer.id, qty: 3, pin: w.a.cookPin });
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    await mgr.post('/api/payments', { staffId: w.a.cook.id, amountCents: 1000, method: 'SALARY_DEDUCTION', paidOn: today() });
    const month = periodMonthFor(today(), 16);
    const s = (await mgr.get(`/api/statements?month=${month}`)).json();
    expect(s.period.startDay).toBe(16);
    expect(s.statements).toHaveLength(1);
    expect(s.statements[0]).toMatchObject({
      staff: { name: 'Cook A' },
      openingCents: 0,
      purchasesCents: 3900,
      paidCents: 1000,
      closingCents: 2900,
      lines: [expect.objectContaining({ item: 'Beer', qty: 3, unitPriceCents: 1300, amountCents: 3900, fridge: 'Bar' })],
      payments: [expect.objectContaining({ method: 'SALARY_DEDUCTION', amountCents: 1000 })],
    });
    const csv = await mgr.get(`/api/statements.csv?month=${month}`);
    expect(csv.body).toContain('Cook A');
    expect(csv.body).toContain('N$29.00');
  });

  it('a later period carries the balance forward as its opening balance', async () => {
    await kiosk(app, w.a.barToken).move({ type: 'TAKE', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin });
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    const [y, m] = periodMonthFor(today(), 16).split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const s = (await mgr.get(`/api/statements?month=${next}`)).json();
    expect(s.statements[0]).toMatchObject({ openingCents: 1300, purchasesCents: 0, closingCents: 1300, lines: [] });
  });

  it('accounts, payments and statements stay inside the manager\'s venue', async () => {
    await kiosk(app, w.b.barToken).move({ type: 'ADD', itemId: w.b.beer.id, qty: 5, pin: w.b.cookPin });
    await kiosk(app, w.b.barToken).move({ type: 'TAKE', itemId: w.b.beer.id, qty: 1, pin: w.b.cookPin });
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    expect((await mgr.get(`/api/accounts?restaurantId=${w.b.r.id}`)).statusCode).toBe(404);
    expect((await mgr.post('/api/payments', { staffId: w.b.cook.id, amountCents: 100, paidOn: today() })).statusCode).toBe(404);
    expect((await mgr.get(`/api/statements?month=2026-11&staffId=${w.b.cook.id}`)).statusCode).toBe(404);
    const own = as(app, await login(app, 'owner@t.test'));
    expect((await own.get('/api/accounts')).statusCode).toBe(400); // owner must pick a venue
    const b = (await own.get(`/api/accounts?restaurantId=${w.b.r.id}`)).json();
    expect(b.rows[0]).toMatchObject({ name: 'Cook B', balanceCents: 1300 });
  });

  it('a manager can record a delivery with its supplier, and a take on someone\'s behalf', async () => {
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    const add = await mgr.post('/api/movements', { fridgeId: w.a.bar.id, itemId: w.a.beer.id, type: 'ADD', qty: 12, supplier: 'NamBev' });
    expect(add.json().movement).toMatchObject({ supplier: 'NamBev', staffId: w.a.manager.id, recordedById: w.a.manager.id });
    const take = await mgr.post('/api/movements', { fridgeId: w.a.bar.id, itemId: w.a.beer.id, type: 'TAKE', qty: 2, staffId: w.a.cook.id });
    expect(take.json().movement).toMatchObject({ staffId: w.a.cook.id, recordedById: w.a.manager.id, amountCents: 2600 });
    expect((await mgr.post('/api/movements', { fridgeId: w.a.bar.id, itemId: w.a.beer.id, type: 'TAKE', qty: 1, staffId: w.b.cook.id })).statusCode).toBe(404);
  });

  it('the dashboard shows stock value, today\'s sales and what is owed', async () => {
    await kiosk(app, w.a.barToken).move({ type: 'TAKE', itemId: w.a.beer.id, qty: 4, pin: w.a.cookPin });
    const d = (await as(app, await login(app, 'mgr.a@t.test')).get('/api/dashboard')).json();
    expect(d.summary[0]).toMatchObject({ stockValueCents: 20 * 1300, salesTodayCents: 5200, owedCents: 5200 });
  });
});
