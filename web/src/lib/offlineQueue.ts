/**
 * Kiosk movements that could not reach the server (Wi-Fi drop in the walk-in) wait here and are
 * sent when the connection returns. Each carries a clientId, so a send that succeeded but whose
 * reply was lost is not counted twice. The server re-checks everything: a queued take can still
 * be refused if the stock is no longer there, and that refusal is shown to staff.
 *
 * The queue holds the PIN that was typed, because the server needs it to know who acted. It is
 * removed the moment the movement is accepted or refused.
 */

export interface QueuedMovement {
  clientId: string;
  type: 'TAKE' | 'ADD' | 'WASTE' | 'TRANSFER';
  itemId: string;
  itemName: string;
  qty: number;
  pin: string;
  expiresOn?: string;
  reason?: string;
  toFridgeId?: string;
  queuedAt: string;
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const KEY = 'fs.offlineQueue';

export function newClientId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function readQueue(s: Storage): QueuedMovement[] {
  try {
    const v = JSON.parse(s.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeQueue(s: Storage, q: QueuedMovement[]) {
  try {
    s.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage full or blocked */
  }
}

export function enqueue(s: Storage, m: QueuedMovement) {
  writeQueue(s, [...readQueue(s).filter((x) => x.clientId !== m.clientId), m]);
}

export type SendResult = { ok: true } | { ok: false; offline: boolean; message: string };

/**
 * Send queued movements in order. Stops at the first offline failure (keep the rest for later);
 * a refusal from the server drops that movement and is reported.
 */
export async function flushQueue(s: Storage, send: (m: QueuedMovement) => Promise<SendResult>) {
  const sent: QueuedMovement[] = [];
  const refused: { m: QueuedMovement; message: string }[] = [];
  for (const m of readQueue(s)) {
    const r = await send(m);
    if (r.ok) sent.push(m);
    else if (r.offline) break;
    else refused.push({ m, message: r.message });
    const done = new Set([...sent, ...refused.map((x) => x.m)].map((x) => x.clientId));
    writeQueue(s, readQueue(s).filter((x) => !done.has(x.clientId)));
  }
  return { sent, refused, remaining: readQueue(s).length };
}
