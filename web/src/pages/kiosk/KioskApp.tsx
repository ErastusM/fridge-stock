import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, get, post, tokens } from '../../lib/api';
import type { KioskData, StockLine } from '../../lib/types';
import { cx, ExpiryBadge, Spinner, StockBadge, useToast } from '../../components/ui';
import { fmtDate, fmtQty, relativeDay } from '../../lib/format';
import { enqueue, flushQueue, newClientId, readQueue, QueuedMovement } from '../../lib/offlineQueue';
import { ActionRequest, ActionSheet } from './ActionSheet';

const DONE: Record<string, string> = { TAKE: 'took', ADD: 'put in', WASTE: 'threw away', TRANSFER: 'moved' };

export default function KioskApp() {
  const [paired, setPaired] = useState(() => !!tokens.device());
  return paired ? <KioskScreen onUnpaired={() => setPaired(false)} /> : <PairScreen onPaired={() => setPaired(true)} />;
}

function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ token: string }>('/kiosk/pair', { code }, 'none');
      tokens.setDevice(r.token);
      onPaired();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kiosk flex min-h-full items-center justify-center bg-navy-800 p-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
        <h1 className="text-2xl font-black text-navy-900">Set up this tablet</h1>
        <p className="mt-2 text-navy-600">
          A manager creates a pairing code under <b>Tablets</b> in the manage app. Type it here to link this tablet to its fridge.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          placeholder="000000"
          className="mt-6 h-20 w-full rounded-2xl text-center text-4xl font-black tracking-[0.4em] ring-2 ring-navy-200 focus:outline-none focus:ring-navy-500"
          aria-label="Pairing code"
        />
        {error && <p className="mt-3 font-semibold text-red-700">{error}</p>}
        <button disabled={code.length !== 6 || busy} onClick={pair} className="mt-6 h-16 w-full rounded-2xl bg-navy-800 text-xl font-bold text-white disabled:bg-navy-200">
          {busy ? 'Pairing…' : 'Pair tablet'}
        </button>
        <Link to="/" className="mt-4 block text-navy-500 underline">
          Back
        </Link>
      </div>
    </div>
  );
}

function KioskScreen({ onUnpaired }: { onUnpaired: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<KioskData | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(() => readQueue(localStorage).length);
  const [selected, setSelected] = useState<StockLine | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [attention, setAttention] = useState(false);
  const [now, setNow] = useState(new Date());
  const close = useCallback(() => setSelected(null), []);

  const send = useCallback(async (m: Omit<QueuedMovement, 'queuedAt' | 'itemName'>) => {
    const { clientId, type, itemId, qty, pin, expiresOn, reason, toFridgeId } = m;
    return post<{ staff: { name: string } }>('/kiosk/movements', { clientId, type, itemId, qty, pin, expiresOn, reason, toFridgeId }, 'device');
  }, []);

  const flush = useCallback(async () => {
    if (readQueue(localStorage).length === 0) return;
    const r = await flushQueue(localStorage, async (m) => {
      try {
        await send(m);
        return { ok: true };
      } catch (e) {
        const err = e as ApiError;
        return { ok: false, offline: err.offline || err.status >= 500, message: err.message };
      }
    });
    if (r.sent.length) toast(`${r.sent.length} saved change${r.sent.length > 1 ? 's' : ''} sent`, 'info');
    for (const x of r.refused) toast(`Not recorded: ${x.m.itemName} — ${x.message}`, 'error');
    setQueued(r.remaining);
  }, [send, toast]);

  const refresh = useCallback(async () => {
    try {
      const d = await get<KioskData>('/kiosk/fridge', 'device');
      setData(d);
      setOnline(true);
      await flush();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        tokens.setDevice(null);
        onUnpaired();
        return;
      }
      setOnline(false);
    }
  }, [flush, onUnpaired]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15_000);
    const c = setInterval(() => setNow(new Date()), 30_000);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(t);
      clearInterval(c);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);

  // Keep the open sheet in step with refreshed stock.
  useEffect(() => {
    if (selected && data) setSelected(data.items.find((i) => i.itemId === selected.itemId) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const categories = useMemo(() => ['All', ...new Set((data?.items ?? []).map((i) => i.category))], [data]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.items ?? []).filter(
      (i) =>
        (category === 'All' || i.category === category) &&
        (!q || i.name.toLowerCase().includes(q)) &&
        (!attention || i.status !== 'OK' || i.expiry !== 'FRESH'),
    );
  }, [data, query, category, attention]);
  const attentionCount = (data?.items ?? []).filter((i) => i.status !== 'OK' || i.expiry !== 'FRESH').length;

  if (!data) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center bg-navy-800 text-white">
        <Spinner />
        {!online && <p>Cannot reach the server. Retrying…</p>}
      </div>
    );
  }
  const tz = data.restaurant.timezone;

  const submit = async (r: ActionRequest): Promise<string | null> => {
    const line = selected!;
    const m = { clientId: newClientId(), itemId: line.itemId, ...r };
    try {
      const res = await send(m);
      toast(`${res.staff.name} ${DONE[r.type]} ${fmtQty(r.qty, line.unit)} × ${line.name}`);
      setSelected(null);
      void refresh();
      return null;
    } catch (e) {
      const err = e as ApiError;
      if (err.offline || err.status >= 500) {
        // A PIN cannot be checked offline; the server checks it when the movement is sent.
        enqueue(localStorage, { ...m, itemName: line.name, queuedAt: new Date().toISOString() });
        setQueued(readQueue(localStorage).length);
        setOnline(false);
        toast('No connection — saved on this tablet, will send when back online', 'info');
        setSelected(null);
        return null;
      }
      return err.message;
    }
  };

  return (
    <div className="kiosk flex min-h-full flex-col">
      <header className="sticky top-0 z-30 bg-navy-800 px-4 py-3 text-white shadow">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-navy-200">{data.restaurant.name}</p>
            <h1 className="text-2xl font-black">{data.fridge.name}</h1>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums">{new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(now)}</p>
            <p className={cx('text-sm font-semibold', online ? 'text-emerald-300' : 'text-amber-300')}>
              {online ? 'Online' : 'Offline'}
              {queued > 0 && ` · ${queued} waiting to send`}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-12 min-w-0 flex-1 rounded-xl px-4 text-navy-900" aria-label="Search items" />
          <button
            onClick={() => setAttention((a) => !a)}
            className={cx('h-12 shrink-0 rounded-xl px-4 font-bold', attention ? 'bg-beacon-500 text-white' : 'bg-navy-700 text-white')}
          >
            Needs attention ({attentionCount})
          </button>
        </div>
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {categories.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={cx('shrink-0 rounded-full px-4 py-2 font-semibold', category === c ? 'bg-white text-navy-900' : 'bg-navy-700 text-navy-100')}>
              {c}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 p-4">
        {items.length === 0 ? (
          <p className="py-16 text-center text-lg text-navy-500">{data.items.length === 0 ? 'No items set up for this fridge yet. A manager adds them under Stock.' : 'Nothing matches.'}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {items.map((i) => (
              <button
                key={i.itemId}
                onClick={() => setSelected(i)}
                aria-label={`${i.name}, ${fmtQty(i.qty, i.unit)}${i.status !== 'OK' ? `, ${i.status.toLowerCase()}` : ''}${i.expiry !== 'FRESH' ? `, ${i.expiry === 'EXPIRED' ? 'expired' : 'use soon'}` : ''}`}
                className={cx(
                  'flex min-h-32 flex-col justify-between rounded-2xl bg-white p-4 text-left shadow-sm ring-2 active:scale-[0.98]',
                  i.expiry === 'EXPIRED' ? 'ring-red-600' : i.status === 'OUT' ? 'ring-beacon-500' : i.status === 'LOW' || i.expiry === 'EXPIRING' ? 'ring-amber-400' : 'ring-transparent',
                )}
              >
                <div>
                  <p className="text-lg font-bold leading-tight text-navy-900">{i.name}</p>
                  <p className="text-xs uppercase tracking-wide text-navy-500">{i.category}</p>
                </div>
                <div className="mt-3">
                  <p className={cx('text-3xl font-black', i.status === 'OUT' ? 'text-beacon-500' : 'text-navy-900')}>{fmtQty(i.qty, i.unit)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <StockBadge status={i.status} />
                    <ExpiryBadge status={i.expiry} />
                    {i.nextExpiry && (
                      <span className="text-xs text-navy-600">
                        use by {fmtDate(i.nextExpiry, tz).slice(0, 5)} ({relativeDay(i.nextExpiry, tz)})
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <ActionSheet line={selected} tz={tz} otherFridges={data.otherFridges} onClose={close} onSubmit={submit} />
    </div>
  );
}
