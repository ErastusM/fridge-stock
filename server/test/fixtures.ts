import type { FastifyInstance } from 'fastify';
import { db } from '../src/db';
import { hashPassword, newToken, pinDigest, sha256 } from '../src/security';

export const PW = 'correct-horse-battery';

export async function wipe() {
  await db.$executeRawUnsafe(
    'TRUNCATE "Movement", "Batch", "FridgeItem", "PairingCode", "Device", "Staff", "Item", "Fridge", "Restaurant" CASCADE',
  );
}

/** Two restaurants, each with two fridges, one kiosk tablet per fridge, and a known cast. */
export async function world() {
  await wipe();
  const pw = await hashPassword(PW);
  const owner = await db.staff.create({ data: { name: 'Owner', role: 'OWNER', email: 'owner@t.test', passwordHash: pw, pinDigest: pinDigest('9999') } });

  async function venue(tag: string, pinBase: number) {
    const r = await db.restaurant.create({ data: { name: `Venue ${tag}` } });
    const walkIn = await db.fridge.create({ data: { restaurantId: r.id, name: 'Walk-in', kind: 'WALK_IN' } });
    const bar = await db.fridge.create({ data: { restaurantId: r.id, name: 'Bar', kind: 'BAR' } });
    const chicken = await db.item.create({ data: { restaurantId: r.id, name: 'Chicken', category: 'Meat', unit: 'KG', defaultShelfLifeDays: 3 } });
    const beer = await db.item.create({ data: { restaurantId: r.id, name: 'Beer', category: 'Drinks', unit: 'EACH', defaultShelfLifeDays: 180 } });
    await db.fridgeItem.create({ data: { fridgeId: walkIn.id, itemId: chicken.id, minQty: 2, parLevel: 10 } });
    await db.fridgeItem.create({ data: { fridgeId: walkIn.id, itemId: beer.id, minQty: 0, parLevel: 0 } });
    await db.fridgeItem.create({ data: { fridgeId: bar.id, itemId: beer.id, minQty: 6, parLevel: 24 } });
    const manager = await db.staff.create({
      data: { name: `Manager ${tag}`, role: 'MANAGER', restaurantId: r.id, email: `mgr.${tag.toLowerCase()}@t.test`, passwordHash: pw, pinDigest: pinDigest(String(pinBase)) },
    });
    const cook = await db.staff.create({ data: { name: `Cook ${tag}`, role: 'STAFF', restaurantId: r.id, pinDigest: pinDigest(String(pinBase + 1)) } });
    const walkInToken = newToken();
    const barToken = newToken();
    await db.device.create({ data: { fridgeId: walkIn.id, name: 'Walk-in tablet', tokenHash: sha256(walkInToken) } });
    await db.device.create({ data: { fridgeId: bar.id, name: 'Bar tablet', tokenHash: sha256(barToken) } });
    return { r, walkIn, bar, chicken, beer, manager, cook, cookPin: String(pinBase + 1), managerPin: String(pinBase), walkInToken, barToken };
  }

  const a = await venue('A', 1000);
  const b = await venue('B', 2000);
  return { owner, ownerPin: '9999', a, b };
}

export async function login(app: FastifyInstance, email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
  if (res.statusCode !== 200) throw new Error(`login ${email}: ${res.body}`);
  return res.json().token as string;
}

export function kiosk(app: FastifyInstance, token: string) {
  return {
    get: () => app.inject({ method: 'GET', url: '/api/kiosk/fridge', headers: { 'x-device-token': token } }),
    move: (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/kiosk/movements', headers: { 'x-device-token': token }, payload }),
  };
}

export function as(app: FastifyInstance, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers }),
    post: (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers, payload: payload as object }),
    put: (url: string, payload: unknown) => app.inject({ method: 'PUT', url, headers, payload: payload as object }),
    patch: (url: string, payload: unknown) => app.inject({ method: 'PATCH', url, headers, payload: payload as object }),
    del: (url: string) => app.inject({ method: 'DELETE', url, headers }),
  };
}
