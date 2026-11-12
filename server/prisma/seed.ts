/**
 * Development seed: two PLACEHOLDER venues for the Lighthouse group (Swakopmund) until the real
 * venues, fridges and item list are supplied. Credentials are generated at random and written
 * to prisma/seed-credentials.md (git-ignored), never printed.
 *
 *   npm run db:seed            # only seeds an empty database
 *   npm run db:seed -- --reset # wipes everything first (development only)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, Unit, FridgeKind, Role } from '@prisma/client';
import { hashPassword, pinDigest } from '../src/security';
import { defaultExpiry, endOfLocalDay, addDays, localDateString } from '../src/domain/time';

const db = new PrismaClient();
const TZ = 'Africa/Windhoek';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

type ItemSeed = [name: string, category: string, unit: Unit, shelfLife: number];
const ITEMS: ItemSeed[] = [
  ['Kingklip fillet', 'Seafood', 'KG', 2],
  ['Calamari tubes', 'Seafood', 'KG', 2],
  ['Walvis Bay oysters', 'Seafood', 'EACH', 3],
  ['Prawns (shell-on)', 'Seafood', 'KG', 2],
  ['Beef fillet', 'Meat', 'KG', 4],
  ['Chicken breast', 'Meat', 'KG', 3],
  ['Oryx loin', 'Meat', 'KG', 4],
  ['Full-cream milk', 'Dairy', 'L', 5],
  ['Fresh cream', 'Dairy', 'L', 7],
  ['Butter (500 g)', 'Dairy', 'PACK', 30],
  ['Cheddar', 'Dairy', 'KG', 21],
  ['Eggs', 'Dairy', 'EACH', 21],
  ['Lettuce', 'Produce', 'EACH', 4],
  ['Tomatoes', 'Produce', 'KG', 5],
  ['Lemons', 'Produce', 'EACH', 14],
  ['Garlic aioli', 'Prep', 'L', 3],
  ['Windhoek Lager 440 ml', 'Drinks', 'EACH', 180],
  ['Savanna Dry 330 ml', 'Drinks', 'EACH', 180],
  ['Soda water 200 ml', 'Drinks', 'EACH', 365],
  ['Orange juice', 'Drinks', 'L', 7],
];

const VENUES: { name: string; fridges: [string, FridgeKind, string[]][] }[] = [
  {
    name: 'Lighthouse Venue A (placeholder)',
    fridges: [
      ['Walk-in cooler', 'WALK_IN', ['Seafood', 'Meat', 'Dairy', 'Produce']],
      ['Prep fridge', 'PREP', ['Prep', 'Produce', 'Dairy']],
      ['Bar fridge', 'BAR', ['Drinks']],
    ],
  },
  {
    name: 'Lighthouse Venue B (placeholder)',
    fridges: [
      ['Walk-in cooler', 'WALK_IN', ['Seafood', 'Meat', 'Dairy', 'Produce', 'Prep']],
      ['Bar fridge', 'BAR', ['Drinks']],
    ],
  },
];

const randomPin = (used: Set<string>) => {
  for (;;) {
    const pin = crypto.randomInt(0, 10000).toString().padStart(4, '0');
    if (!used.has(pin)) {
      used.add(pin);
      return pin;
    }
  }
};
const randomPassword = () => crypto.randomBytes(12).toString('base64url');

async function reset() {
  await db.movement.deleteMany();
  await db.batch.deleteMany();
  await db.fridgeItem.deleteMany();
  await db.pairingCode.deleteMany();
  await db.device.deleteMany();
  await db.staff.deleteMany();
  await db.item.deleteMany();
  await db.fridge.deleteMany();
  await db.restaurant.deleteMany();
}

async function main() {
  if (process.argv.includes('--reset')) await reset();
  if ((await db.restaurant.count()) > 0) {
    console.log('Database already has restaurants — nothing seeded. Use -- --reset to start over.');
    return;
  }
  const usedPins = new Set<string>();
  const creds: string[] = [];
  const now = new Date();
  const today = localDateString(now, TZ);

  const ownerPin = randomPin(usedPins);
  const ownerPw = randomPassword();
  await db.staff.create({
    data: { name: 'Group Owner', role: Role.OWNER, email: 'owner@lighthouse.test', passwordHash: await hashPassword(ownerPw), pinDigest: pinDigest(ownerPin) },
  });
  creds.push(`| Owner (all venues) | owner@lighthouse.test | \`${ownerPw}\` | ${ownerPin} |`);

  for (const [vi, v] of VENUES.entries()) {
    const r = await db.restaurant.create({ data: { name: v.name, timezone: TZ } });
    const letter = String.fromCharCode(97 + vi);
    const mgrPin = randomPin(usedPins);
    const mgrPw = randomPassword();
    await db.staff.create({
      data: { name: `Manager ${letter.toUpperCase()}`, role: Role.MANAGER, restaurantId: r.id, email: `manager.${letter}@lighthouse.test`, passwordHash: await hashPassword(mgrPw), pinDigest: pinDigest(mgrPin) },
    });
    creds.push(`| Manager — ${v.name} | manager.${letter}@lighthouse.test | \`${mgrPw}\` | ${mgrPin} |`);
    const staffIds: string[] = [];
    for (const n of ['Anna', 'Johannes', 'Selma', 'Petrus']) {
      const pin = randomPin(usedPins);
      const s = await db.staff.create({ data: { name: `${n} (${letter.toUpperCase()})`, role: Role.STAFF, restaurantId: r.id, pinDigest: pinDigest(pin) } });
      staffIds.push(s.id);
      creds.push(`| Staff — ${s.name} | — | — | ${pin} |`);
    }

    const items = new Map<string, { id: string; unit: Unit; category: string; shelf: number }>();
    for (const [name, category, unit, shelf] of ITEMS) {
      const it = await db.item.create({ data: { restaurantId: r.id, name, category, unit, defaultShelfLifeDays: shelf } });
      items.set(name, { id: it.id, unit, category, shelf });
    }

    let k = 0;
    for (const [fname, kind, cats] of v.fridges) {
      const f = await db.fridge.create({ data: { restaurantId: r.id, name: fname, kind } });
      for (const it of items.values()) {
        if (!cats.includes(it.category)) continue;
        // The same item can live in two fridges (lettuce in walk-in and prep); keep prep small.
        const counted = it.unit === 'EACH' || it.unit === 'PACK' || it.unit === 'PORTION';
        const par = it.category === 'Drinks' ? 48 : counted ? 24 : 6;
        const min = it.category === 'Drinks' ? 12 : counted ? 6 : 1.5;
        await db.fridgeItem.create({ data: { fridgeId: f.id, itemId: it.id, minQty: min, parLevel: par } });
        k++;
        // A spread of situations: plenty, low, out, expiring, expired.
        const scenario = k % 7;
        if (scenario === 3) continue; // OUT
        const qty = scenario === 2 ? (counted ? Math.max(1, Math.floor(min / 2)) : 1) : counted ? Math.round(par * 0.8) : 4.5;
        const fresh = defaultExpiry(now, it.shelf, TZ);
        const expiresAt = scenario === 4 ? endOfLocalDay(addDays(today, 1), TZ) : scenario === 5 ? endOfLocalDay(addDays(today, -1), TZ) : fresh;
        const staffId = staffIds[k % staffIds.length];
        await db.batch.create({ data: { fridgeId: f.id, itemId: it.id, qtyRemaining: qty, expiresAt, receivedAt: new Date(now.getTime() - 26 * 3600_000) } });
        await db.movement.create({
          data: { fridgeId: f.id, itemId: it.id, type: 'ADD', qty, qtyAfter: qty, staffId, reason: 'Opening stock', expiresAt, createdAt: new Date(now.getTime() - 26 * 3600_000) },
        });
      }
    }
  }

  const file = path.join(__dirname, 'seed-credentials.md');
  fs.writeFileSync(
    file,
    [
      '# Development seed credentials (git-ignored — do not commit)',
      '',
      `Generated ${now.toISOString()}. Re-running the seed with \`-- --reset\` replaces them.`,
      '',
      '| Who | Email | Password | Kiosk PIN |',
      '|---|---|---|---|',
      ...creds,
      '',
    ].join('\n'),
  );
  console.log(`Seeded ${VENUES.length} placeholder venues. Credentials written to ${file}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
