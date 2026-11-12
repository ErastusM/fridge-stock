import { describe, expect, it } from 'vitest';
import { enqueue, flushQueue, readQueue, QueuedMovement, Storage } from './offlineQueue';
import { addDays, fmtDate, fmtQty, localDate, relativeDay } from './format';

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}
const mv = (id: string): QueuedMovement => ({ clientId: id, type: 'TAKE', itemId: 'i', itemName: 'Beer', qty: 1, pin: '1234', queuedAt: '' });

describe('offline queue', () => {
  it('sends in order, drops refusals, keeps the rest when the connection drops again', async () => {
    const s = memory();
    ['a', 'b', 'c', 'd'].forEach((id) => enqueue(s, mv(id)));
    const r = await flushQueue(s, async (m) =>
      m.clientId === 'b' ? { ok: false, offline: false, message: 'Only 0 left' } : m.clientId === 'c' ? { ok: false, offline: true, message: '' } : { ok: true },
    );
    expect(r.sent.map((x) => x.clientId)).toEqual(['a']);
    expect(r.refused.map((x) => [x.m.clientId, x.message])).toEqual([['b', 'Only 0 left']]);
    expect(readQueue(s).map((x) => x.clientId)).toEqual(['c', 'd']);
  });
  it('enqueueing the same clientId twice keeps one', () => {
    const s = memory();
    enqueue(s, mv('a'));
    enqueue(s, mv('a'));
    expect(readQueue(s)).toHaveLength(1);
  });
  it('survives corrupt storage', () => {
    const s = memory();
    s.setItem('fs.offlineQueue', '{not json');
    expect(readQueue(s)).toEqual([]);
  });
});

describe('format (Africa/Windhoek)', () => {
  it('dates are dd/MM/yyyy local', () => {
    expect(fmtDate('2026-11-12T22:30:00Z')).toBe('13/11/2026');
    expect(localDate(new Date('2026-11-12T22:30:00Z'))).toBe('2026-11-13');
  });
  it('quantities', () => {
    expect(fmtQty(3, 'EACH')).toBe('3');
    expect(fmtQty(1.5, 'KG')).toBe('1.5 kg');
    expect(fmtQty(2, 'PACK')).toBe('2 packs');
  });
  it('relative days', () => {
    const now = new Date('2026-11-12T10:00:00Z');
    expect(relativeDay('2026-11-12T21:59:59Z', 'Africa/Windhoek', now)).toBe('today');
    expect(relativeDay('2026-11-13T21:59:59Z', 'Africa/Windhoek', now)).toBe('tomorrow');
    expect(relativeDay('2026-11-10T21:59:59Z', 'Africa/Windhoek', now)).toBe('2 days ago');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
