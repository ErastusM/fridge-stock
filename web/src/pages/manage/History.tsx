import { useState } from 'react';
import { downloadCsv, get } from '../../lib/api';
import type { Fridge, Item, Movement, StaffMember } from '../../lib/types';
import { Button, Card, cx, Empty, ErrorNote, Field, inputCls, Spinner, useLoad } from '../../components/ui';
import { addDays, fmtDateTime, fmtQty, localDate, MOVEMENT_LABEL } from '../../lib/format';
import { scopeQuery, useManage, useTz } from './context';
import { FridgePicker } from './FridgePicker';

const TYPE_TONE: Record<string, string> = {
  ADD: 'bg-emerald-100 text-emerald-800',
  TAKE: 'bg-navy-100 text-navy-800',
  WASTE: 'bg-red-100 text-red-800',
  ADJUST: 'bg-amber-100 text-amber-900',
  TRANSFER_OUT: 'bg-sand-100 text-navy-800',
  TRANSFER_IN: 'bg-sand-100 text-navy-800',
};

export default function History() {
  const { restaurantId } = useManage();
  const tz = useTz();
  const today = localDate(new Date(), tz);
  const [f, setF] = useState({ fridgeId: '', itemId: '', staffId: '', type: '', from: addDays(today, -6), to: today });
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const fridges = useLoad(() => get<Fridge[]>(`/fridges${scopeQuery(restaurantId)}`), [restaurantId]);
  const items = useLoad(() => get<Item[]>(`/items${scopeQuery(restaurantId)}`), [restaurantId]);
  const staff = useLoad(() => get<StaffMember[]>(`/staff${scopeQuery(restaurantId)}`), [restaurantId]);
  const q = scopeQuery(restaurantId, { ...f, page: String(page), limit: '50' });
  const rows = useLoad(() => get<{ total: number; rows: Movement[] }>(`/movements${q}`), [q]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setPage(1);
  };
  const pages = Math.max(1, Math.ceil((rows.data?.total ?? 0) / 50));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black">History</h1>
        <Button
          variant="secondary"
          onClick={async () => {
            setError(null);
            try {
              await downloadCsv(`/movements.csv${scopeQuery(restaurantId, f)}`, 'movements.csv');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Download CSV
        </Button>
      </div>
      <Card className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Fridge">
          <FridgePicker fridges={fridges.data ?? []} value={f.fridgeId} onChange={(id) => set('fridgeId')({ target: { value: id } })} allowAll />
        </Field>
        <Field label="Item">
          <select value={f.itemId} onChange={set('itemId')} className={inputCls}>
            <option value="">All items</option>
            {(items.data ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Who">
          <select value={f.staffId} onChange={set('staffId')} className={inputCls}>
            <option value="">Everyone</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What">
          <select value={f.type} onChange={set('type')} className={inputCls}>
            <option value="">Everything</option>
            {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={f.from} max={f.to} onChange={set('from')} className={inputCls} />
        </Field>
        <Field label="To">
          <input type="date" value={f.to} min={f.from} onChange={set('to')} className={inputCls} />
        </Field>
      </Card>
      <ErrorNote error={error ?? rows.error} />
      {rows.loading && !rows.data ? (
        <Spinner />
      ) : rows.data?.rows.length === 0 ? (
        <Empty>Nothing recorded for these filters.</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-navy-50 text-navy-600">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">What</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Left</th>
                <th className="px-3 py-2">Fridge</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {rows.data?.rows.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-navy-600">{fmtDateTime(m.createdAt, m.fridge.restaurant.timezone)}</td>
                  <td className="px-3 py-2">
                    <span className={cx('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold', TYPE_TONE[m.type])}>{MOVEMENT_LABEL[m.type]}</span>
                  </td>
                  <td className="px-3 py-2 font-semibold">{m.item.name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {m.type === 'ADJUST' && m.qty > 0 ? '+' : ''}
                    {m.type === 'ADJUST' && m.qty < 0 ? '−' : ''}
                    {fmtQty(Math.abs(m.qty), m.item.unit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-navy-500">{fmtQty(m.qtyAfter, m.item.unit)}</td>
                  <td className="px-3 py-2 text-navy-600">{m.fridge.name}</td>
                  <td className="px-3 py-2">{m.staff.name}</td>
                  <td className="px-3 py-2 text-navy-500">{m.reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-navy-600">
            Page {page} of {pages} · {rows.data?.total} entries
          </span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
