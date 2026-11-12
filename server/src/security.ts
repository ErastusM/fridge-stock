import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config';

export const PIN_RE = /^\d{4,6}$/;

/**
 * A PIN identifies the person on a shared tablet, so it must be looked up, not just checked:
 * a keyed HMAC (not a plain hash) makes the column useless without the server's PIN_SECRET.
 */
export const pinDigest = (pin: string): string => crypto.createHmac('sha256', config.pinSecret).update(pin).digest('hex');

export const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex');
export const newToken = (): string => crypto.randomBytes(32).toString('base64url');
export const newPairingCode = (): string => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

/** Small fixed-window limiter for unauthenticated endpoints (login, pairing). */
export class RateLimiter {
  private hits = new Map<string, { n: number; resetAt: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  /** true when the caller is still within the limit. */
  hit(key: string, now = Date.now()): boolean {
    const e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      this.hits.set(key, { n: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    e.n += 1;
    return e.n <= this.max;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
