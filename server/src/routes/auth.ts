import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db';
import { config } from '../config';
import { tooMany, unauthorized } from '../errors';
import { principalOf, requireRole } from '../principal';
import { hashPassword, RateLimiter, verifyPassword } from '../security';

const loginLimiter = new RateLimiter(5, 5 * 60_000);
// Checked against when the email is unknown, so that case costs the same time as a wrong password.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'));

const LoginBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req) => {
    const { email, password } = LoginBody.parse(req.body);
    const key = email.toLowerCase();
    if (!loginLimiter.hit(key)) throw tooMany('Too many attempts. Try again in a few minutes.');
    const staff = await db.staff.findUnique({ where: { email: key }, include: { restaurant: true } });
    const ok = await verifyPassword(password, staff?.passwordHash ?? (await getDummyHash()));
    if (!staff || !ok || !staff.active || staff.role === 'STAFF') throw unauthorized('Email or password is wrong');
    loginLimiter.reset(key);
    const token = app.jwt.sign({ sub: staff.id }, { expiresIn: config.jwtTtl });
    return {
      token,
      user: { id: staff.id, name: staff.name, role: staff.role, restaurantId: staff.restaurantId, restaurantName: staff.restaurant?.name ?? null },
    };
  });

  app.get('/auth/me', { preHandler: requireRole('MANAGER') }, async (req) => {
    const p = principalOf(req);
    const r = p.restaurantId ? await db.restaurant.findUnique({ where: { id: p.restaurantId } }) : null;
    return { ...p, restaurantName: r?.name ?? null };
  });
}
