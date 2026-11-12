import crypto from 'node:crypto';
import { MovementType, Prisma, Unit } from '@prisma/client';
import { db, Tx } from '../db';
import { conflict, badRequest } from '../errors';
import { BatchLike, consumeFifo, round3, totalQty } from '../domain/fifo';
import { quantityError } from '../domain/quantity';
import { defaultExpiry } from '../domain/time';
import { chargeFor } from '../domain/money';

/**
 * Every change to what is in a fridge goes through this module, inside one transaction that
 * first locks the (fridge, item) row. Two tablets taking the last item at once therefore run
 * one after the other, and the second sees the stock the first left.
 */

export interface Actor {
  staffId: string;
  deviceId?: string | null;
  /** A manager entering it on the person's behalf in the manage app. */
  recordedById?: string | null;
}

interface ItemRef {
  id: string;
  unit: Unit;
  defaultShelfLifeDays: number;
  priceCents?: number | null;
}

export interface MovementInput {
  fridgeId: string;
  item: ItemRef;
  timezone: string;
  actor: Actor;
  clientId?: string | null;
}

/** Make sure the fridge stocks the item, then lock that row for the rest of the transaction. */
async function lockFridgeItem(tx: Tx, fridgeId: string, itemId: string) {
  await tx.$executeRaw`
    INSERT INTO "FridgeItem" (id, "fridgeId", "itemId", "minQty", "parLevel")
    VALUES (${'fi_' + crypto.randomUUID()}, ${fridgeId}, ${itemId}, 0, 0)
    ON CONFLICT ("fridgeId", "itemId") DO NOTHING`;
  await tx.$queryRaw`SELECT id FROM "FridgeItem" WHERE "fridgeId" = ${fridgeId} AND "itemId" = ${itemId} FOR UPDATE`;
}

async function batchesOf(tx: Tx, fridgeId: string, itemId: string): Promise<BatchLike[]> {
  return tx.batch.findMany({
    where: { fridgeId, itemId, qtyRemaining: { gt: 0 } },
    select: { id: true, qtyRemaining: true, expiresAt: true, receivedAt: true },
  });
}

function checkQty(qty: number, unit: Unit) {
  const err = quantityError(qty, unit);
  if (err) throw badRequest(err);
}

/** Lock order is always by fridge id, so two opposite transfers cannot deadlock. */
async function lockInOrder(tx: Tx, itemId: string, fridgeIds: string[]) {
  for (const f of [...new Set(fridgeIds)].sort()) await lockFridgeItem(tx, f, itemId);
}

async function deduct(tx: Tx, fridgeId: string, itemId: string, qty: number) {
  const batches = await batchesOf(tx, fridgeId, itemId);
  const r = consumeFifo(batches, qty);
  if (!r.ok) {
    throw conflict(`Only ${r.available} in this fridge — cannot take ${qty}. If the count is wrong, a manager can correct it with a stock count.`, {
      available: r.available,
    });
  }
  for (const dd of r.deductions) {
    await tx.batch.update({ where: { id: dd.batchId }, data: { qtyRemaining: { decrement: dd.qty } } });
  }
  return { deductions: r.deductions, after: round3(r.available - round3(qty)) };
}

/** A retried request carrying the same clientId returns what the first one did. */
async function replay(clientId: string | null | undefined) {
  if (!clientId) return null;
  return db.movement.findUnique({ where: { clientId } });
}

async function run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw conflict('This change was already recorded');
    }
    throw e;
  }
}

export async function addStock(input: MovementInput & { qty: number; expiresAt?: Date | null; reason?: string | null; supplier?: string | null }) {
  checkQty(input.qty, input.item.unit);
  const existing = await replay(input.clientId);
  if (existing) return existing;
  const expiresAt = input.expiresAt ?? defaultExpiry(new Date(), input.item.defaultShelfLifeDays, input.timezone);
  return run(async (tx) => {
    await lockFridgeItem(tx, input.fridgeId, input.item.id);
    const before = totalQty(await batchesOf(tx, input.fridgeId, input.item.id));
    await tx.batch.create({
      data: { fridgeId: input.fridgeId, itemId: input.item.id, qtyRemaining: input.qty, expiresAt },
    });
    return tx.movement.create({
      data: {
        fridgeId: input.fridgeId,
        itemId: input.item.id,
        type: MovementType.ADD,
        qty: input.qty,
        qtyAfter: round3(before + input.qty),
        staffId: input.actor.staffId,
        deviceId: input.actor.deviceId ?? null,
        reason: input.reason ?? null,
        supplier: input.supplier?.trim() || null,
        recordedById: input.actor.recordedById ?? null,
        expiresAt,
        clientId: input.clientId ?? null,
      },
    });
  });
}

export async function removeStock(input: MovementInput & { qty: number; type: 'TAKE' | 'WASTE'; reason?: string | null }) {
  checkQty(input.qty, input.item.unit);
  if (input.type === 'WASTE' && !input.reason?.trim()) throw badRequest('Say why it was thrown away');
  const existing = await replay(input.clientId);
  if (existing) return existing;
  return run(async (tx) => {
    await lockFridgeItem(tx, input.fridgeId, input.item.id);
    const { after } = await deduct(tx, input.fridgeId, input.item.id, input.qty);
    // Only a TAKE is charged to the person; waste is the business's loss. The price is frozen here.
    const price = input.type === 'TAKE' ? input.item.priceCents ?? null : null;
    return tx.movement.create({
      data: {
        fridgeId: input.fridgeId,
        itemId: input.item.id,
        type: input.type,
        qty: input.qty,
        qtyAfter: after,
        staffId: input.actor.staffId,
        deviceId: input.actor.deviceId ?? null,
        recordedById: input.actor.recordedById ?? null,
        reason: input.reason?.trim() || null,
        unitPriceCents: price,
        amountCents: price === null ? null : chargeFor(input.qty, price),
        clientId: input.clientId ?? null,
      },
    });
  });
}

/** Out of one fridge into another of the same restaurant, keeping each batch's use-by date. */
export async function transferStock(input: MovementInput & { qty: number; toFridgeId: string; reason?: string | null }) {
  checkQty(input.qty, input.item.unit);
  if (input.toFridgeId === input.fridgeId) throw badRequest('Choose a different fridge to move it to');
  const existing = await replay(input.clientId);
  if (existing) return existing;
  const group = crypto.randomUUID();
  return run(async (tx) => {
    await lockInOrder(tx, input.item.id, [input.fridgeId, input.toFridgeId]);
    const { deductions, after } = await deduct(tx, input.fridgeId, input.item.id, input.qty);
    const targetBefore = totalQty(await batchesOf(tx, input.toFridgeId, input.item.id));
    const out = await tx.movement.create({
      data: {
        fridgeId: input.fridgeId,
        itemId: input.item.id,
        type: MovementType.TRANSFER_OUT,
        qty: input.qty,
        qtyAfter: after,
        staffId: input.actor.staffId,
        deviceId: input.actor.deviceId ?? null,
        reason: input.reason?.trim() || null,
        transferGroup: group,
        clientId: input.clientId ?? null,
      },
    });
    let running = targetBefore;
    for (const dd of deductions) {
      await tx.batch.create({ data: { fridgeId: input.toFridgeId, itemId: input.item.id, qtyRemaining: dd.qty, expiresAt: dd.expiresAt } });
      running = round3(running + dd.qty);
      await tx.movement.create({
        data: {
          fridgeId: input.toFridgeId,
          itemId: input.item.id,
          type: MovementType.TRANSFER_IN,
          qty: dd.qty,
          qtyAfter: running,
          staffId: input.actor.staffId,
          deviceId: input.actor.deviceId ?? null,
          reason: input.reason?.trim() || null,
          expiresAt: dd.expiresAt,
          transferGroup: group,
        },
      });
    }
    return out;
  });
}

/**
 * Stock count: set what is really there. A surplus becomes a new batch with the item's
 * default shelf life; a shortfall is drawn FIFO. One signed ADJUST movement records it.
 * Returns null when the count matches.
 */
export async function adjustStock(tx: Tx, input: MovementInput & { countedQty: number; reason: string }) {
  const err = quantityError(input.countedQty, input.item.unit, { allowZero: true });
  if (err) throw badRequest(err);
  await lockFridgeItem(tx, input.fridgeId, input.item.id);
  const current = totalQty(await batchesOf(tx, input.fridgeId, input.item.id));
  const delta = round3(input.countedQty - current);
  if (delta === 0) return null;
  let expiresAt: Date | null = null;
  if (delta > 0) {
    expiresAt = defaultExpiry(new Date(), input.item.defaultShelfLifeDays, input.timezone);
    await tx.batch.create({ data: { fridgeId: input.fridgeId, itemId: input.item.id, qtyRemaining: delta, expiresAt } });
  } else {
    await deduct(tx, input.fridgeId, input.item.id, -delta);
  }
  return tx.movement.create({
    data: {
      fridgeId: input.fridgeId,
      itemId: input.item.id,
      type: MovementType.ADJUST,
      qty: delta,
      qtyAfter: input.countedQty,
      staffId: input.actor.staffId,
      deviceId: input.actor.deviceId ?? null,
      reason: input.reason,
      expiresAt,
    },
  });
}

export const runStockTransaction = run;
