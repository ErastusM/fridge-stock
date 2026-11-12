import { useEffect, useState } from 'react';
import { get, post } from '../../lib/api';
import type { Fridge, StockLine } from '../../lib/types';
import { Button, Card, Empty, ErrorNote, Field, inputCls, Spinner, useLoad, useToast } from '../../components/ui';
import { fmtQty, UNIT_LABEL, Unit } from '../../lib/format';
import { scopeQuery, useManage } from './context';
import { FridgePicker } from './FridgePicker';

/** Count what is really in a fridge; every difference becomes a correction in the history. */
export default function StockCount() {
  const { restaurantId } = useManage();
  const toast = useToast();
  const fridges = useLoad(() => get<Fridge[]>(`/fridges${scopeQuery(restaurantId)}`), [restaurantId]);
  const [fridgeId, setFridgeId] = useState('');
  const lines = useLoad(() => (fridgeId ? get<StockLine[]>(`/fridges/${fridgeId}/items`) : Promise.resolve([])), [fridgeId]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('Stock count');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setCounts({}), [fridgeId]);

  const entered = (lines.data ?? []).filter((l) => counts[l.itemId] !== undefined && counts[l.itemId] !== '');
  const changes = entered.filter((l) => Number(counts[l.itemId]) !== l.qty);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ adjusted: number }>('/stock-counts', {
        fridgeId,
        reason,
        counts: entered.map((l) => ({ itemId: l.itemId, countedQty: Number(counts[l.itemId]) })),
      });
      toast(r.adjusted ? `${r.adjusted} item${r.adjusted > 1 ? 's' : ''} corrected` : 'Count matches — nothing to correct');
      setCounts({});
      await lines.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (fridges.loading && !fridges.data) return <Spinner />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Stock count</h1>
      <p className="text-navy-600">Count each item and type what is actually there. Leave a line blank to skip it. Only differences are recorded.</p>
      <FridgePicker fridges={fridges.data ?? []} value={fridgeId} onChange={setFridgeId} />
      {lines.loading && !lines.data ? (
        <Spinner />
      ) : (lines.data ?? []).length === 0 ? (
        <Empty>No items in this fridge.</Empty>
      ) : (
        <Card className="divide-y divide-navy-100 p-0">
          {lines.data!.map((l) => {
            const v = counts[l.itemId] ?? '';
            const diff = v === '' ? null : Math.round((Number(v) - l.qty) * 1000) / 1000;
            return (
              <div key={l.itemId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-40 flex-1">
                  <p className="font-semibold">{l.name}</p>
                  <p className="text-sm text-navy-500">System says {fmtQty(l.qty, l.unit)}</p>
                </div>
                <input
                  value={v}
                  onChange={(e) => setCounts((c) => ({ ...c, [l.itemId]: e.target.value }))}
                  inputMode="decimal"
                  placeholder="Counted"
                  className={inputCls + ' w-28'}
                  aria-label={`Counted ${l.name}`}
                />
                <span className="w-16 text-sm text-navy-500">{UNIT_LABEL[l.unit as Unit] ?? l.unit}</span>
                <span className={`w-20 text-right text-sm font-bold ${diff === null || diff === 0 ? 'text-navy-400' : diff > 0 ? 'text-emerald-700' : 'text-beacon-600'}`}>
                  {diff === null ? '' : diff === 0 ? 'matches' : `${diff > 0 ? '+' : ''}${diff}`}
                </span>
              </div>
            );
          })}
        </Card>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <Field label="Reason">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} maxLength={200} />
          </Field>
        </div>
        <Button disabled={busy || entered.length === 0 || reason.trim().length < 3} onClick={submit}>
          {busy ? 'Saving…' : `Save count (${changes.length} correction${changes.length === 1 ? '' : 's'})`}
        </Button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}
