import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@prisma/client';
import { db } from './db';
import { config } from './config';
import { forbidden, notFound, unauthorized } from './errors';
import { sha256 } from './security';

export interface Principal {
  id: string;
  name: string;
  role: Role;
  /** null only for an OWNER, who sees every restaurant. */
  restaurantId: string | null;
}

export interface KioskDevice {
  id: string;
  name: string;
  fridgeId: string;
  fridgeName: string;
  restaurantId: string;
  restaurantName: string;
  timezone: string;
  failedPinAttempts: number;
  pinLockedUntil: Date | null;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    device?: KioskDevice;
  }
}

const RANK: Record<Role, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };

/**
 * Manage app: a valid token AND a still-active MANAGER/OWNER account. The account is re-read
 * on every request so deactivating someone or changing their role takes effect at once.
 */
export function requireRole(min: Exclude<Role, 'STAFF'>) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    const staff = await db.staff.findUnique({ where: { id: req.user.sub } });
    if (!staff || !staff.active || RANK[staff.role] < RANK.MANAGER) throw unauthorized();
    if (RANK[staff.role] < RANK[min]) throw forbidden();
    req.principal = { id: staff.id, name: staff.name, role: staff.role, restaurantId: staff.restaurantId };
  };
}

export function principalOf(req: FastifyRequest): Principal {
  if (!req.principal) throw unauthorized();
  return req.principal;
}

/** Kiosk tablet: the device token issued at pairing, bound to exactly one fridge. */
export async function requireDevice(req: FastifyRequest) {
  const token = req.headers['x-device-token'];
  if (typeof token !== 'string' || token.length < 20) throw unauthorized('This tablet is not paired');
  const dev = await db.device.findUnique({
    where: { tokenHash: sha256(token) },
    include: { fridge: { include: { restaurant: true } } },
  });
  if (!dev || dev.revokedAt || !dev.fridge.active) throw unauthorized('This tablet is not paired');
  if (!dev.lastSeenAt || Date.now() - dev.lastSeenAt.getTime() > 60_000) {
    await db.device.update({ where: { id: dev.id }, data: { lastSeenAt: new Date() } });
  }
  req.device = {
    id: dev.id,
    name: dev.name,
    fridgeId: dev.fridgeId,
    fridgeName: dev.fridge.name,
    restaurantId: dev.fridge.restaurantId,
    restaurantName: dev.fridge.restaurant.name,
    timezone: dev.fridge.restaurant.timezone,
    failedPinAttempts: dev.failedPinAttempts,
    pinLockedUntil: dev.pinLockedUntil,
  };
}

export function deviceOf(req: FastifyRequest): KioskDevice {
  if (!req.device) throw unauthorized('This tablet is not paired');
  return req.device;
}

// ---- Restaurant scoping: the ONE place that decides what a principal may see. ----

export function restaurantScope(p: Principal): { restaurantId?: string } {
  return p.role === 'OWNER' ? {} : { restaurantId: p.restaurantId ?? '__none__' };
}

/** Narrow to one restaurant (optional query param), refusing one outside the principal's scope. */
export function restaurantFilter(p: Principal, requested?: string): { restaurantId?: string } {
  if (!requested) return restaurantScope(p);
  assertRestaurant(p, requested);
  return { restaurantId: requested };
}

export function assertRestaurant(p: Principal, restaurantId: string | null) {
  if (p.role === 'OWNER') return;
  if (!restaurantId || restaurantId !== p.restaurantId) throw notFound('Restaurant not found');
}

export async function fridgeInScope(p: Principal, fridgeId: string) {
  const f = await db.fridge.findFirst({ where: { id: fridgeId, ...restaurantScope(p) }, include: { restaurant: true } });
  if (!f) throw notFound('Fridge not found');
  return f;
}

export async function itemInScope(p: Principal, itemId: string) {
  const i = await db.item.findFirst({ where: { id: itemId, ...restaurantScope(p) } });
  if (!i) throw notFound('Item not found');
  return i;
}

export const expiringHours = () => config.expiringHours;
