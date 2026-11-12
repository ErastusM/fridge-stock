import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { config } from '../config';
import { badRequest, notFound, tooMany, unauthorized } from '../errors';
import { deviceOf, KioskDevice, requireDevice } from '../principal';
import { newToken, pinDigest, PIN_RE, RateLimiter, sha256 } from '../security';
import { addStock, removeStock, transferStock } from '../services/stock';
import { stockLines } from '../services/view';
import { endOfLocalDay, parseDateString } from '../domain/time';

const pairLimiter = new RateLimiter(10, 60_000);

const PairBody = z.object({ code: z.string().regex(/^\d{6}$/, 'The pairing code has 6 digits') });

const MoveBody = z.object({
  type: z.enum(['TAKE', 'ADD', 'WASTE', 'TRANSFER']),
  itemId: z.string().min(1),
  qty: z.number(),
  pin: z.string().regex(PIN_RE, 'PIN is 4 to 6 digits'),
  expiresOn: z.string().optional(),
  reason: z.string().max(200).optional(),
  toFridgeId: z.string().optional(),
  clientId: z.string().min(8).max(64).optional(),
});

/**
 * The PIN alone says who is at the tablet. Wrong PINs count against the TABLET (there is no
 * person to count them against), and five in a row lock it for a minute.
 */
async function identifyStaff(device: KioskDevice, pin: string) {
  const now = new Date();
  if (device.pinLockedUntil && device.pinLockedUntil > now) {
    const secs = Math.ceil((device.pinLockedUntil.getTime() - now.getTime()) / 1000);
    throw tooMany(`Too many wrong PINs. Try again in ${secs} seconds.`);
  }
  const staff = await db.staff.findFirst({
    where: {
      pinDigest: pinDigest(pin),
      active: true,
      OR: [{ restaurantId: device.restaurantId }, { role: 'OWNER' }],
    },
  });
  if (!staff) {
    const d = await db.device.update({ where: { id: device.id }, data: { failedPinAttempts: { increment: 1 } } });
    if (d.failedPinAttempts >= config.pinMaxAttempts) {
      await db.device.update({
        where: { id: device.id },
        data: { failedPinAttempts: 0, pinLockedUntil: new Date(Date.now() + config.pinLockSeconds * 1000) },
      });
      throw tooMany(`Too many wrong PINs. Try again in ${config.pinLockSeconds} seconds.`);
    }
    throw unauthorized('PIN not recognised');
  }
  if (device.failedPinAttempts > 0 || device.pinLockedUntil) {
    await db.device.update({ where: { id: device.id }, data: { failedPinAttempts: 0, pinLockedUntil: null } });
  }
  return staff;
}

export async function kioskRoutes(app: FastifyInstance) {
  app.post('/kiosk/pair', async (req) => {
    if (!pairLimiter.hit(req.ip)) throw tooMany('Too many attempts. Wait a minute and try again.');
    const { code } = PairBody.parse(req.body);
    const now = new Date();
    const pc = await db.pairingCode.findFirst({
      where: { codeHash: sha256(code), usedAt: null, expiresAt: { gt: now } },
      include: { fridge: { include: { restaurant: true } } },
    });
    if (!pc || !pc.fridge.active) throw badRequest('That code is not valid or has expired. Ask a manager for a new one.');
    // Claim it conditionally, so one code pairs exactly one tablet.
    const claimed = await db.pairingCode.updateMany({ where: { id: pc.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count !== 1) throw badRequest('That code has already been used.');
    const token = newToken();
    const device = await db.device.create({ data: { fridgeId: pc.fridgeId, name: pc.deviceName, tokenHash: sha256(token) } });
    pairLimiter.reset(req.ip);
    return {
      token,
      device: { id: device.id, name: device.name },
      fridge: { id: pc.fridge.id, name: pc.fridge.name },
      restaurant: { id: pc.fridge.restaurant.id, name: pc.fridge.restaurant.name },
    };
  });

  app.get('/kiosk/fridge', { preHandler: requireDevice }, async (req) => {
    const d = deviceOf(req);
    const [items, otherFridges] = await Promise.all([
      stockLines({ fridgeIds: [d.fridgeId] }),
      db.fridge.findMany({
        where: { restaurantId: d.restaurantId, active: true, id: { not: d.fridgeId } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      device: { id: d.id, name: d.name },
      fridge: { id: d.fridgeId, name: d.fridgeName },
      restaurant: { id: d.restaurantId, name: d.restaurantName, timezone: d.timezone },
      expiringHours: config.expiringHours,
      items,
      otherFridges,
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/kiosk/movements', { preHandler: requireDevice }, async (req) => {
    const d = deviceOf(req);
    const body = MoveBody.parse(req.body);
    const staff = await identifyStaff(d, body.pin);

    const fi = await db.fridgeItem.findUnique({
      where: { fridgeId_itemId: { fridgeId: d.fridgeId, itemId: body.itemId } },
      include: { item: true },
    });
    if (!fi || !fi.item.active) throw notFound('This item is not kept in this fridge');

    const base = {
      fridgeId: d.fridgeId,
      item: fi.item,
      timezone: d.timezone,
      actor: { staffId: staff.id, deviceId: d.id },
      clientId: body.clientId ?? null,
    };
    let movement;
    if (body.type === 'ADD') {
      let expiresAt: Date | null = null;
      if (body.expiresOn) {
        if (!parseDateString(body.expiresOn)) throw badRequest('Use-by date is not a valid date');
        expiresAt = endOfLocalDay(body.expiresOn, d.timezone);
      }
      movement = await addStock({ ...base, qty: body.qty, expiresAt, reason: body.reason });
    } else if (body.type === 'TRANSFER') {
      if (!body.toFridgeId) throw badRequest('Choose the fridge to move it to');
      const to = await db.fridge.findFirst({ where: { id: body.toFridgeId, restaurantId: d.restaurantId, active: true } });
      if (!to) throw notFound('That fridge is not in this restaurant');
      movement = await transferStock({ ...base, qty: body.qty, toFridgeId: to.id, reason: body.reason });
    } else {
      movement = await removeStock({ ...base, qty: body.qty, type: body.type, reason: body.reason });
    }
    return { movement, staff: { id: staff.id, name: staff.name } };
  });
}
