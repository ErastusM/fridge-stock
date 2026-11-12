import 'dotenv/config';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://fridge:fridge_dev_pw@127.0.0.1:55480/fridge_test';

if (!/_test\b/.test(new URL(TEST_DATABASE_URL).pathname)) {
  throw new Error('TEST_DATABASE_URL must name a database ending in _test — the suite empties it.');
}
