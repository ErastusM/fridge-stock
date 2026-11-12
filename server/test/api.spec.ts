import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { db } from '../src/db';
import { as, kiosk, login, world } from './fixtures';
import { endOfLocalDay, localDateString, addDays } from '../src/domain/time';

let app: FastifyInstance;
let w: Awaited<ReturnType<typeof world>>;
const TZ = 'Africa/Windhoek';
const today = () => localDateString(new Date(), TZ);

beforeAll(async () => {
  app = await buildApp({ logger: false });
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
beforeEach(async () => {
  w = await world();
});

const line = async (token: string, itemName: string) => {
  const res = await kiosk(app, token).get();
  expect(res.statusCode).toBe(200);
  return res.json().items.find((i: { name: string }) => i.name === itemName);
};

describe('kiosk: putting in and taking out', () => {
  it('adds with a default use-by, takes FIFO, and records who did it', async () => {
    const k = kiosk(app, w.a.walkInToken);
    const soon = addDays(today(), 1);
    const later = addDays(today(), 5);
    expect((await k.move({ type: 'ADD', itemId: w.a.chicken.id, qty: 3, pin: w.a.cookPin, expiresOn: later })).statusCode).toBe(200);
    expect((await k.move({ type: 'ADD', itemId: w.a.chicken.id, qty: 2, pin: w.a.cookPin, expiresOn: soon })).statusCode).toBe(200);

    const take = await k.move({ type: 'TAKE', itemId: w.a.chicken.id, qty: 2.5, pin: w.a.cookPin });
    expect(take.statusCode).toBe(200);
    expect(take.json()).toMatchObject({ staff: { name: 'Cook A' }, movement: { type: 'TAKE', qty: 2.5, qtyAfter: 2.5 } });

    const l = await line(w.a.walkInToken, 'Chicken');
    // The batch expiring tomorrow went first; 0.5 came out of the later one.
    expect(l.batches).toHaveLength(1);
    expect(l.batches[0]).toMatchObject({ qty: 2.5, expiresAt: endOfLocalDay(later, TZ).toISOString() });
    expect(l).toMatchObject({ qty: 2.5, status: 'OK' });
  });

  it('defaults the use-by to today + shelf life', async () => {
    await kiosk(app, w.a.walkInToken).move({ type: 'ADD', itemId: w.a.chicken.id, qty: 1, pin: w.a.cookPin });
    const l = await line(w.a.walkInToken, 'Chicken');
    expect(l.batches[0].expiresAt).toBe(endOfLocalDay(addDays(today(), 3), TZ).toISOString());
  });

  it('refuses to take more than is there — stock never goes negative', async () => {
    const k = kiosk(app, w.a.walkInToken);
    await k.move({ type: 'ADD', itemId: w.a.chicken.id, qty: 1, pin: w.a.cookPin });
    const res = await k.move({ type: 'TAKE', itemId: w.a.chicken.id, qty: 1.5, pin: w.a.cookPin });
    expect(res.statusCode).toBe(409);
    expect(res.json().details).toEqual({ available: 1 });
    expect((await line(w.a.walkInToken, 'Chicken')).qty).toBe(1);
  });

  it('two tablets taking the last item at the same moment: exactly one succeeds', async () => {
    const k = kiosk(app, w.a.walkInToken);
    await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => k.move({ type: 'TAKE', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin })),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(19);
    const batches = await db.batch.findMany({ where: { fridgeId: w.a.walkIn.id, itemId: w.a.beer.id } });
    expect(batches.reduce((s, b) => s + b.qtyRemaining, 0)).toBe(0);
    expect(await db.movement.count({ where: { type: 'TAKE' } })).toBe(1);
  });

  it('a retried request with the same clientId is recorded once', async () => {
    const k = kiosk(app, w.a.walkInToken);
    const body = { type: 'ADD', itemId: w.a.beer.id, qty: 6, pin: w.a.cookPin, clientId: 'tablet-retry-0001' };
    const one = await k.move(body);
    const two = await k.move(body);
    expect(one.statusCode).toBe(200);
    expect(two.statusCode).toBe(200);
    expect(two.json().movement.id).toBe(one.json().movement.id);
    expect((await line(w.a.walkInToken, 'Beer')).qty).toBe(6);
  });

  it('waste needs a reason; whole units for counted items', async () => {
    const k = kiosk(app, w.a.walkInToken);
    await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 4, pin: w.a.cookPin });
    expect((await k.move({ type: 'WASTE', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin })).statusCode).toBe(400);
    expect((await k.move({ type: 'TAKE', itemId: w.a.beer.id, qty: 1.5, pin: w.a.cookPin })).statusCode).toBe(400);
    const ok = await k.move({ type: 'WASTE', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin, reason: 'Dropped' });
    expect(ok.json().movement).toMatchObject({ type: 'WASTE', reason: 'Dropped', qtyAfter: 3 });
  });

  it('flags LOW at the minimum and OUT at zero', async () => {
    const k = kiosk(app, w.a.walkInToken);
    expect((await line(w.a.walkInToken, 'Chicken')).status).toBe('OUT');
    await k.move({ type: 'ADD', itemId: w.a.chicken.id, qty: 2, pin: w.a.cookPin });
    expect(await line(w.a.walkInToken, 'Chicken')).toMatchObject({ status: 'LOW', reorderQty: 8 });
  });

  it('moves stock to another fridge keeping its use-by date', async () => {
    const k = kiosk(app, w.a.walkInToken);
    const exp = addDays(today(), 9);
    await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 10, pin: w.a.cookPin, expiresOn: exp });
    const res = await k.move({ type: 'TRANSFER', itemId: w.a.beer.id, qty: 4, pin: w.a.cookPin, toFridgeId: w.a.bar.id });
    expect(res.statusCode).toBe(200);
    expect((await line(w.a.walkInToken, 'Beer')).qty).toBe(6);
    const bar = await line(w.a.barToken, 'Beer');
    expect(bar).toMatchObject({ qty: 4, status: 'LOW' });
    expect(bar.batches[0].expiresAt).toBe(endOfLocalDay(exp, TZ).toISOString());
  });

  it('cannot move stock to another restaurant\'s fridge, or act on an item the fridge does not keep', async () => {
    const k = kiosk(app, w.a.walkInToken);
    await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 2, pin: w.a.cookPin });
    expect((await k.move({ type: 'TRANSFER', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin, toFridgeId: w.b.bar.id })).statusCode).toBe(404);
    expect((await k.move({ type: 'ADD', itemId: w.b.beer.id, qty: 1, pin: w.a.cookPin })).statusCode).toBe(404);
  });
});

describe('kiosk: PINs and tablets', () => {
  it('a PIN from another restaurant is not recognised; an owner\'s works anywhere', async () => {
    const k = kiosk(app, w.a.walkInToken);
    expect((await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 1, pin: w.b.cookPin })).statusCode).toBe(401);
    const res = await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 1, pin: w.ownerPin });
    expect(res.json().staff.name).toBe('Owner');
  });

  it('five wrong PINs lock the tablet', async () => {
    const k = kiosk(app, w.a.walkInToken);
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 1, pin: '0000' })).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 429]);
    // Even the right PIN is refused while locked.
    expect((await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin })).statusCode).toBe(429);
  });

  it('a deactivated person\'s PIN stops working', async () => {
    await db.staff.update({ where: { id: w.a.cook.id }, data: { active: false } });
    expect((await kiosk(app, w.a.walkInToken).move({ type: 'ADD', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin })).statusCode).toBe(401);
  });

  it('pairs a tablet with a one-time code, and a revoked tablet is shut out', async () => {
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    const code = (await mgr.post(`/api/fridges/${w.a.bar.id}/pairing-codes`, { deviceName: 'New bar tablet' })).json().code;
    const pair = await app.inject({ method: 'POST', url: '/api/kiosk/pair', payload: { code } });
    expect(pair.statusCode).toBe(200);
    const token = pair.json().token;
    expect((await kiosk(app, token).get()).json().fridge.name).toBe('Bar');
    expect((await app.inject({ method: 'POST', url: '/api/kiosk/pair', payload: { code } })).statusCode).toBe(400);

    const dev = (await mgr.get('/api/devices')).json().find((d: { name: string }) => d.name === 'New bar tablet');
    expect((await mgr.del(`/api/devices/${dev.id}`)).statusCode).toBe(200);
    expect((await kiosk(app, token).get()).statusCode).toBe(401);
  });

  it('a manager cannot create a pairing code for another restaurant\'s fridge', async () => {
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    expect((await mgr.post(`/api/fridges/${w.b.bar.id}/pairing-codes`, { deviceName: 'x' })).statusCode).toBe(404);
  });

  it('no token, no stock', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/kiosk/fridge' })).statusCode).toBe(401);
  });
});

describe('manage: access', () => {
  it('kitchen staff cannot sign in to the manage app', async () => {
    await db.staff.update({ where: { id: w.a.cook.id }, data: { email: 'cook@t.test', passwordHash: (await db.staff.findUnique({ where: { id: w.a.manager.id } }))!.passwordHash } });
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'cook@t.test', password: 'correct-horse-battery' } });
    expect(res.statusCode).toBe(401);
  });

  it('a manager sees only their restaurant; the owner sees both', async () => {
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    const own = as(app, await login(app, 'owner@t.test'));
    expect((await mgr.get('/api/restaurants')).json().map((r: { name: string }) => r.name)).toEqual(['Venue A']);
    expect((await own.get('/api/restaurants')).json()).toHaveLength(2);
    expect((await mgr.get(`/api/fridges/${w.b.walkIn.id}/items`)).statusCode).toBe(404);
    expect((await mgr.get(`/api/fridges?restaurantId=${w.b.r.id}`)).statusCode).toBe(404);
    expect((await mgr.get('/api/dashboard')).json().summary.map((s: { name: string }) => s.name)).toEqual(['Venue A']);
    expect((await own.get('/api/dashboard')).json().summary).toHaveLength(2);
    expect((await mgr.patch(`/api/items/${w.b.chicken.id}`, { name: 'Hacked' })).statusCode).toBe(404);
  });

  it('only an owner adds restaurants or owners; a manager cannot touch an owner', async () => {
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    expect((await mgr.post('/api/restaurants', { name: 'X' })).statusCode).toBe(403);
    expect((await mgr.post('/api/staff', { name: 'Boss', role: 'OWNER', pin: '4321', email: 'b@t.test', password: 'long-enough-pw' })).statusCode).toBe(403);
    expect((await mgr.patch(`/api/staff/${w.owner.id}`, { active: false })).statusCode).toBe(404);
  });

  it('PINs must be unique among people who share a tablet', async () => {
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    expect((await mgr.post('/api/staff', { name: 'Dup', pin: w.a.cookPin })).statusCode).toBe(409);
    expect((await mgr.post('/api/staff', { name: 'Dup owner pin', pin: w.ownerPin })).statusCode).toBe(409);
    // Another restaurant's PIN is fine — they never share a tablet.
    expect((await mgr.post('/api/staff', { name: 'Same as B', pin: w.b.cookPin })).statusCode).toBe(200);
  });
});

describe('manage: counts, history, reports', () => {
  it('a stock count corrects both ways and records who and why', async () => {
    const k = kiosk(app, w.a.walkInToken);
    await k.move({ type: 'ADD', itemId: w.a.chicken.id, qty: 5, pin: w.a.cookPin });
    await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 10, pin: w.a.cookPin });
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    const res = await mgr.post('/api/stock-counts', {
      fridgeId: w.a.walkIn.id,
      reason: 'Weekly count',
      counts: [
        { itemId: w.a.chicken.id, countedQty: 4.25 },
        { itemId: w.a.beer.id, countedQty: 12 },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().adjusted).toBe(2);
    expect((await line(w.a.walkInToken, 'Chicken')).qty).toBe(4.25);
    expect((await line(w.a.walkInToken, 'Beer')).qty).toBe(12);
    const adj = await db.movement.findMany({ where: { type: 'ADJUST' }, orderBy: { qty: 'asc' } });
    expect(adj.map((m) => [m.qty, m.staffId, m.reason])).toEqual([
      [-0.75, w.a.manager.id, 'Weekly count'],
      [2, w.a.manager.id, 'Weekly count'],
    ]);
  });

  it('a count for another restaurant\'s items is refused whole', async () => {
    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    const res = await mgr.post('/api/stock-counts', { fridgeId: w.a.walkIn.id, reason: 'Count', counts: [{ itemId: w.b.chicken.id, countedQty: 1 }] });
    expect(res.statusCode).toBe(400);
  });

  it('history filters and exports; usage report sums per item per day', async () => {
    const k = kiosk(app, w.a.walkInToken);
    await k.move({ type: 'ADD', itemId: w.a.beer.id, qty: 10, pin: w.a.cookPin });
    await k.move({ type: 'TAKE', itemId: w.a.beer.id, qty: 3, pin: w.a.cookPin });
    await k.move({ type: 'TAKE', itemId: w.a.beer.id, qty: 2, pin: w.a.managerPin });
    await k.move({ type: 'WASTE', itemId: w.a.beer.id, qty: 1, pin: w.a.cookPin, reason: 'Expired' });
    await kiosk(app, w.b.walkInToken).move({ type: 'ADD', itemId: w.b.beer.id, qty: 99, pin: w.b.cookPin });

    const mgr = as(app, await login(app, 'mgr.a@t.test'));
    const all = (await mgr.get('/api/movements')).json();
    expect(all.total).toBe(4); // venue B's movement is not visible
    const takes = (await mgr.get(`/api/movements?type=TAKE&staffId=${w.a.cook.id}`)).json();
    expect(takes.rows.map((r: { qty: number }) => r.qty)).toEqual([3]);

    const usage = (await mgr.get(`/api/reports/usage?from=${today()}&to=${today()}`)).json();
    expect(usage.totals).toEqual([expect.objectContaining({ name: 'Beer', taken: 5, wasted: 1, added: 10 })]);
    expect(usage.wasteReasons).toEqual([{ reason: 'Expired', count: 1 }]);

    const csv = await mgr.get(`/api/movements.csv?from=${today()}&to=${today()}`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body.split('\r\n').filter(Boolean)).toHaveLength(5); // header + 4 movements
    expect(csv.body).toContain('Cook A');
  });

  it('the dashboard lists what to reorder and what is expiring', async () => {
    const k = kiosk(app, w.a.walkInToken);
    await k.move({ type: 'ADD', itemId: w.a.chicken.id, qty: 1, pin: w.a.cookPin, expiresOn: today() });
    const d = (await as(app, await login(app, 'mgr.a@t.test')).get('/api/dashboard')).json();
    expect(d.reorder.map((r: { name: string; fridgeName: string; status: string }) => `${r.fridgeName}/${r.name}/${r.status}`).sort()).toEqual([
      'Bar/Beer/OUT',
      'Walk-in/Beer/OUT',
      'Walk-in/Chicken/LOW',
    ]);
    expect(d.expiring).toEqual([expect.objectContaining({ name: 'Chicken', expiry: 'EXPIRING' })]);
  });
});
