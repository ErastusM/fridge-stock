import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FridgeKind, Role, Unit } from '@prisma/client';
import { db } from '../db';
import { config } from '../config';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import {
  fridgeInScope,
  itemInScope,
  Principal,
  principalOf,
  requireRole,
  restaurantFilter,
  restaurantScope,
} from '../principal';
import { hashPassword, newPairingCode, pinDigest, PIN_RE, sha256 } from '../security';
import { stockLines } from '../services/view';
import { quantityError } from '../domain/quantity';

const manager = { preHandler: requireRole('MANAGER') };
const owner = { preHandler: requireRole('OWNER') };

const Id = z.object({ id: z.string().min(1) });
const RestaurantQuery = z.object({ restaurantId: z.string().optional() });
const name = z.string().trim().min(1).max(80);

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The restaurant a new record goes into: the manager's own, or the one an owner names. */
function targetRestaurant(p: Principal, requested?: string): string {
  if (p.role === 'OWNER') {
    if (!requested) throw badRequest('Choose a restaurant');
    return requested;
  }
  if (requested && requested !== p.restaurantId) throw notFound('Restaurant not found');
  return p.restaurantId!;
}

async function restaurantExists(id: string) {
  if (!(await db.restaurant.findUnique({ where: { id } }))) throw notFound('Restaurant not found');
}

/**
 * Who could type this PIN at the same tablet: everyone in the same restaurant, plus owners
 * (who can use any tablet). Two of them sharing a PIN would make the movement log lie.
 */
async function assertPinFree(digest: string, restaurantId: string | null, role: Role, exceptId?: string) {
  const clash = await db.staff.findFirst({
    where: {
      pinDigest: digest,
      active: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      ...(role === 'OWNER' ? {} : { OR: [{ restaurantId }, { role: 'OWNER' }] }),
    },
  });
  if (clash) throw conflict('That PIN is already in use. Choose another.');
}

const RestaurantBody = z.object({
  name,
  timezone: z.string().refine(validTimezone, 'Unknown time zone').default('Africa/Windhoek'),
  statementStartDay: z.number().int().min(1).max(28).default(16),
});
const FridgeBody = z.object({ restaurantId: z.string().optional(), name, kind: z.nativeEnum(FridgeKind).default('REACH_IN') });
const FridgePatch = z.object({ name: name.optional(), kind: z.nativeEnum(FridgeKind).optional(), active: z.boolean().optional() });
const ItemBody = z.object({
  restaurantId: z.string().optional(),
  name,
  category: z.string().trim().min(1).max(40).default('General'),
  unit: z.nativeEnum(Unit).default('EACH'),
  defaultShelfLifeDays: z.number().int().min(0).max(3650).default(3),
  /** Selling price in cents; null = not charged. */
  priceCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
});
const ItemPatch = ItemBody.omit({ restaurantId: true }).partial().extend({ active: z.boolean().optional() });
const FridgeItemBody = z.object({ minQty: z.number().default(0), parLevel: z.number().default(0) });
const StaffBody = z.object({
  restaurantId: z.string().nullable().optional(),
  name,
  role: z.nativeEnum(Role).default('STAFF'),
  pin: z.string().regex(PIN_RE, 'PIN is 4 to 6 digits'),
  email: z.string().email().max(200).optional(),
  password: z.string().min(10, 'Password needs at least 10 characters').max(200).optional(),
});
const StaffPatch = z.object({
  name: name.optional(),
  role: z.nativeEnum(Role).optional(),
  pin: z.string().regex(PIN_RE, 'PIN is 4 to 6 digits').optional(),
  email: z.string().email().max(200).nullable().optional(),
  password: z.string().min(10, 'Password needs at least 10 characters').max(200).optional(),
  active: z.boolean().optional(),
});
const PairingBody = z.object({ deviceName: name });

const staffView = (s: { id: string; name: string; role: Role; restaurantId: string | null; email: string | null; active: boolean; passwordHash?: string | null }) => ({
  id: s.id,
  name: s.name,
  role: s.role,
  restaurantId: s.restaurantId,
  email: s.email,
  active: s.active,
  canSignIn: !!s.passwordHash && s.role !== 'STAFF',
});

export async function setupRoutes(app: FastifyInstance) {
  // ---------- restaurants ----------
  app.get('/restaurants', manager, async (req) => {
    const p = principalOf(req);
    return db.restaurant.findMany({
      where: p.role === 'OWNER' ? {} : { id: p.restaurantId ?? '__none__' },
      orderBy: { name: 'asc' },
    });
  });
  app.post('/restaurants', owner, async (req) => {
    const b = RestaurantBody.parse(req.body);
    return db.restaurant.create({ data: b });
  });
  app.patch('/restaurants/:id', owner, async (req) => {
    const { id } = Id.parse(req.params);
    const b = RestaurantBody.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    await restaurantExists(id);
    return db.restaurant.update({ where: { id }, data: b });
  });

  // ---------- fridges ----------
  app.get('/fridges', manager, async (req) => {
    const p = principalOf(req);
    const q = RestaurantQuery.parse(req.query);
    const fridges = await db.fridge.findMany({
      where: restaurantFilter(p, q.restaurantId),
      include: { restaurant: { select: { name: true } }, _count: { select: { items: true } }, devices: { where: { revokedAt: null }, select: { id: true } } },
      orderBy: [{ restaurant: { name: 'asc' } }, { name: 'asc' }],
    });
    return fridges.map(({ devices, _count, restaurant, ...f }) => ({ ...f, restaurantName: restaurant.name, itemCount: _count.items, deviceCount: devices.length }));
  });
  app.post('/fridges', manager, async (req) => {
    const p = principalOf(req);
    const b = FridgeBody.parse(req.body);
    const restaurantId = targetRestaurant(p, b.restaurantId);
    await restaurantExists(restaurantId);
    return db.fridge.create({ data: { restaurantId, name: b.name, kind: b.kind } });
  });
  app.patch('/fridges/:id', manager, async (req) => {
    const p = principalOf(req);
    const { id } = Id.parse(req.params);
    await fridgeInScope(p, id);
    return db.fridge.update({ where: { id }, data: FridgePatch.parse(req.body) });
  });

  // ---------- items (the restaurant's catalogue) ----------
  app.get('/items', manager, async (req) => {
    const p = principalOf(req);
    const q = RestaurantQuery.parse(req.query);
    return db.item.findMany({ where: restaurantFilter(p, q.restaurantId), orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  });
  app.post('/items', manager, async (req) => {
    const p = principalOf(req);
    const b = ItemBody.parse(req.body);
    const restaurantId = targetRestaurant(p, b.restaurantId);
    await restaurantExists(restaurantId);
    const { restaurantId: _ignored, ...data } = b;
    return db.item.create({ data: { ...data, restaurantId } });
  });
  app.patch('/items/:id', manager, async (req) => {
    const p = principalOf(req);
    const { id } = Id.parse(req.params);
    const item = await itemInScope(p, id);
    const b = ItemPatch.parse(req.body);
    if (b.unit && b.unit !== item.unit) {
      const held = await db.batch.count({ where: { itemId: id, qtyRemaining: { gt: 0 } } });
      if (held > 0) throw conflict('Cannot change the unit while this item is in stock — the quantities would change meaning.');
    }
    return db.item.update({ where: { id }, data: b });
  });

  // ---------- what each fridge stocks, with thresholds ----------
  app.get('/fridges/:id/items', manager, async (req) => {
    const p = principalOf(req);
    const { id } = Id.parse(req.params);
    await fridgeInScope(p, id);
    return stockLines({ fridgeIds: [id] });
  });
  app.put('/fridges/:id/items/:itemId', manager, async (req) => {
    const p = principalOf(req);
    const { id, itemId } = z.object({ id: z.string(), itemId: z.string() }).parse(req.params);
    const fridge = await fridgeInScope(p, id);
    const item = await itemInScope(p, itemId);
    if (item.restaurantId !== fridge.restaurantId) throw badRequest('That item belongs to another restaurant');
    const b = FridgeItemBody.parse(req.body);
    for (const [label, v] of [['Minimum', b.minQty], ['Par level', b.parLevel]] as const) {
      const err = quantityError(v, item.unit, { allowZero: true });
      if (err) throw badRequest(`${label}: ${err}`);
    }
    return db.fridgeItem.upsert({
      where: { fridgeId_itemId: { fridgeId: id, itemId } },
      create: { fridgeId: id, itemId, ...b },
      update: b,
    });
  });
  app.delete('/fridges/:id/items/:itemId', manager, async (req) => {
    const p = principalOf(req);
    const { id, itemId } = z.object({ id: z.string(), itemId: z.string() }).parse(req.params);
    await fridgeInScope(p, id);
    const held = await db.batch.count({ where: { fridgeId: id, itemId, qtyRemaining: { gt: 0 } } });
    if (held > 0) throw conflict('This fridge still holds some of it. Take, move or count it to zero first.');
    await db.fridgeItem.deleteMany({ where: { fridgeId: id, itemId } });
    return { ok: true };
  });

  // ---------- staff ----------
  app.get('/staff', manager, async (req) => {
    const p = principalOf(req);
    const q = RestaurantQuery.parse(req.query);
    const where =
      p.role === 'OWNER'
        ? q.restaurantId
          ? { OR: [{ restaurantId: q.restaurantId }, { role: Role.OWNER }] }
          : {}
        : { OR: [{ restaurantId: p.restaurantId }, { role: Role.OWNER }] };
    const rows = await db.staff.findMany({ where, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return rows.map(staffView);
  });

  app.post('/staff', manager, async (req) => {
    const p = principalOf(req);
    const b = StaffBody.parse(req.body);
    if (b.role === 'OWNER' && p.role !== 'OWNER') throw forbidden('Only an owner can add an owner');
    const restaurantId = b.role === 'OWNER' ? null : targetRestaurant(p, b.restaurantId ?? undefined);
    if (restaurantId) await restaurantExists(restaurantId);
    if (b.role !== 'STAFF' && (!b.email || !b.password)) throw badRequest('Managers and owners need an email and password to sign in');
    await assertPinFree(pinDigest(b.pin), restaurantId, b.role);
    const s = await db.staff.create({
      data: {
        name: b.name,
        role: b.role,
        restaurantId,
        pinDigest: pinDigest(b.pin),
        email: b.role === 'STAFF' ? null : b.email!.toLowerCase(),
        passwordHash: b.role === 'STAFF' ? null : await hashPassword(b.password!),
      },
    });
    return staffView(s);
  });

  app.patch('/staff/:id', manager, async (req) => {
    const p = principalOf(req);
    const { id } = Id.parse(req.params);
    const b = StaffPatch.parse(req.body);
    const s = await db.staff.findUnique({ where: { id } });
    if (!s) throw notFound('Person not found');
    if (p.role !== 'OWNER') {
      if (s.role === 'OWNER' || s.restaurantId !== p.restaurantId) throw notFound('Person not found');
      if (b.role === 'OWNER') throw forbidden('Only an owner can make someone an owner');
    }
    if (s.id === p.id && (b.active === false || (b.role && b.role !== s.role))) {
      throw badRequest('You cannot deactivate yourself or change your own role');
    }
    const role = b.role ?? s.role;
    const restaurantId = role === 'OWNER' ? null : s.restaurantId;
    if (role !== 'OWNER' && !restaurantId) throw badRequest('Give this person a restaurant before changing their role');
    const email = b.email === undefined ? s.email : b.email?.toLowerCase() ?? null;
    if (role !== 'STAFF' && (!email || (!s.passwordHash && !b.password))) {
      throw badRequest('Managers and owners need an email and password to sign in');
    }
    // A new PIN, a new role (an owner's PIN must be unique everywhere) or reactivation can each clash.
    const digest = b.pin ? pinDigest(b.pin) : s.pinDigest;
    const active = b.active ?? s.active;
    if (active && (b.pin || role !== s.role || !s.active)) await assertPinFree(digest, restaurantId, role, s.id);
    const updated = await db.staff.update({
      where: { id },
      data: {
        name: b.name,
        role,
        restaurantId,
        active: b.active,
        email: role === 'STAFF' ? null : email,
        pinDigest: digest,
        ...(b.password ? { passwordHash: await hashPassword(b.password) } : {}),
        ...(role === 'STAFF' ? { passwordHash: null } : {}),
      },
    });
    return staffView(updated);
  });

  // ---------- kiosk tablets ----------
  app.get('/devices', manager, async (req) => {
    const p = principalOf(req);
    const q = RestaurantQuery.parse(req.query);
    const rows = await db.device.findMany({
      where: { fridge: restaurantFilter(p, q.restaurantId) },
      include: { fridge: { include: { restaurant: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      fridgeId: d.fridgeId,
      fridgeName: d.fridge.name,
      restaurantName: d.fridge.restaurant.name,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt,
      createdAt: d.createdAt,
    }));
  });
  app.post('/fridges/:id/pairing-codes', manager, async (req) => {
    const p = principalOf(req);
    const { id } = Id.parse(req.params);
    const fridge = await fridgeInScope(p, id);
    if (!fridge.active) throw badRequest('This fridge is switched off');
    const { deviceName } = PairingBody.parse(req.body);
    const now = new Date();
    // Retry until the code is not one already waiting to be used.
    for (let i = 0; i < 10; i++) {
      const code = newPairingCode();
      const clash = await db.pairingCode.findFirst({ where: { codeHash: sha256(code), usedAt: null, expiresAt: { gt: now } } });
      if (clash) continue;
      const expiresAt = new Date(now.getTime() + config.pairingCodeMinutes * 60_000);
      await db.pairingCode.create({ data: { fridgeId: id, deviceName, codeHash: sha256(code), expiresAt } });
      return { code, expiresAt, fridgeName: fridge.name };
    }
    throw conflict('Could not create a code. Try again.');
  });
  app.delete('/devices/:id', manager, async (req) => {
    const p = principalOf(req);
    const { id } = Id.parse(req.params);
    const d = await db.device.findFirst({ where: { id, fridge: restaurantScope(p) } });
    if (!d) throw notFound('Tablet not found');
    await db.device.update({ where: { id }, data: { revokedAt: d.revokedAt ?? new Date() } });
    return { ok: true };
  });

}
