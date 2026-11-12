import 'dotenv/config';

function secret(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  if (process.env.NODE_ENV === 'production' && (v.length < 32 || v.startsWith('dev-only'))) {
    throw new Error(`${name} must be at least 32 random characters in production`);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4100),
  host: process.env.HOST ?? '127.0.0.1',
  jwtSecret: secret('JWT_SECRET'),
  pinSecret: secret('PIN_SECRET'),
  expiringHours: Number(process.env.EXPIRING_HOURS ?? 48),
  jwtTtl: '12h',
  pinMaxAttempts: 5,
  pinLockSeconds: 60,
  pairingCodeMinutes: 15,
};
