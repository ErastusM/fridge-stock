import { useMemo, useState } from 'react';
import { del, get, put } from '../../lib/api';
import type { Fridge, Item, StockLine } from '../../lib/types';
import { Button, Card, Empty, ErrorNote, ExpiryBadge, inputCls, Spinner, StockBadge, useLoad, useToast } from '../../components/ui';
import { fmtDate, fmtQty, UNIT_LABEL, Unit } from '../../lib/format';
import { scopeQuery, useManage, useTz } from './context';
import { FridgePicker } from './FridgePicker';

/** What each fridge holds, and the minimum / par level that drive the reorder list. */
export default function StockPage() {
  const { restaurantId } = useManage();
  const tz = useTz();
  const toast = useToast();
  const fridges = useLoad(() => get<Fridge[]>(`/fridges${scopeQuery(restaurantId)}`), [restaurantId]);
  const [fridgeId, setFridgeId] = useState('');
  const fridge = fridges.data?.find((f) => f.id === fridgeId);
  const lines = useLoad(() => (fridgeId ? get<StockLine[]>(`/fridges/${fridgeId}/items`) : Promise.resolve([])), [fridgeId]);
  const items = useLoad(() => (fridge ? get<Item[]>(`/items?restaurantId=${fridge.restaurantId}`) : Promise.resolve([])), [fridge?.restaurantId]);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);

  const unassigned = useMemo(() => {
    const have = new Set((lines.data ?? []).map((l) => l.itemId));
    return (items.data ?? []).filter((i) => i.active && !have.has(i.id));
  }, [lines.data, items.data]);

  const save = async (itemId: string, minQty: number, parLevel: number) => {
    setError(null);
    try {
      await put(`/fridges/${fridgeId}/items/${itemId}`, { minQty, parLevel });
      toast('Saved');
      await lines.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (l: StockLine) => {
    setError(null);
    try {
      await del(`/fridges/${fridgeId}/items/${l.itemId}`);
      toast(`${l.name} removed from ${l.fridgeName}`);
      await lines.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (fridges.loading && !fridges.data) return <Spinner />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Stock</h1>
      {fridges.data?.length === 0 ? (
        <Empty>No fridges yet. Add one under Fridges &amp; items.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <FridgePicker fridges={fridges.data ?? []} value={fridgeId} onChange={setFridgeId} />
            <div className="flex gap-2">
              <select value={adding} onChange={(e) => setAdding(e.target.value)} className={inputCls + ' max-w-xs'} aria-label="Item to stock here">
                <option value="">Stock another item here…</option>
                {unassigned.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.category})
                  </option>
                ))}
              </select>
              <Button
                disabled={!adding}
                onClick={async () => {
                  await save(adding, 0, 0);
                  setAdding('');
                }}
              >
                Add
              </Button>
            </div>
          </div>
          <ErrorNote error={error ?? lines.error} />
          {lines.loading && !lines.data ? (
            <Spinner />
          ) : (lines.data ?? []).length === 0 ? (
            <Empty>This fridge has no items yet. Add one above.</Empty>
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead className="bg-navy-50 text-navy-600">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">In stock</th>
                    <th className="px-3 py-2">Next use-by</th>
                    <th className="px-3 py-2">Minimum</th>
                    <th className="px-3 py-2">Par level</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {lines.data!.map((l) => (
                    <Row key={l.itemId} l={l} tz={tz} onSave={save} onRemove={remove} />
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <p className="text-sm text-navy-500">
            An item is <b>LOW</b> at or below its minimum and goes on the reorder list; the order quantity tops it back up to the par level. A minimum of 0 means
            it is never flagged low.
          </p>
        </>
      )}
    </div>
  );
}

function Row({ l, tz, onSave, onRemove }: { l: StockLine; tz: string; onSave: (id: string, min: number, par: number) => Promise<void>; onRemove: (l: StockLine) => void }) {
  const [min, setMin] = useState(String(l.minQty));
  const [par, setPar] = useState(String(l.parLevel));
  const dirty = Number(min) !== l.minQty || Number(par) !== l.parLevel;
  const u = UNIT_LABEL[l.unit as Unit] ?? l.unit;
  return (
    <tr>
      <td className="px-3 py-2">
        <span className="font-semibold">{l.name}</span> <StockBadge status={l.status} /> <ExpiryBadge status={l.expiry} />
        <div className="text-xs text-navy-500">{l.category}</div>
      </td>
      <td className="px-3 py-2 text-right font-semibold">{fmtQty(l.qty, l.unit)}</td>
      <td className="px-3 py-2 text-navy-600">{l.nextExpiry ? fmtDate(l.nextExpiry, tz) : '—'}</td>
      <td className="px-3 py-2">
        <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" className={inputCls + ' w-20'} aria-label={`Minimum for ${l.name} (${u})`} />
      </td>
      <td className="px-3 py-2">
        <input value={par} onChange={(e) => setPar(e.target.value)} inputMode="decimal" className={inputCls + ' w-20'} aria-label={`Par level for ${l.name} (${u})`} />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {dirty && (
          <Button size="sm" onClick={() => onSave(l.itemId, Number(min), Number(par))}>
            Save
          </Button>
        )}
        {!dirty && l.qty === 0 && (
          <Button size="sm" variant="ghost" onClick={() => onRemove(l)}>
            Remove
          </Button>
        )}
      </td>
    </tr>
  );
}
