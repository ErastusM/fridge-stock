import { Link } from 'react-router-dom';
import { get } from '../../lib/api';
import type { Dashboard as D } from '../../lib/types';
import { Card, Empty, ErrorNote, ExpiryBadge, Spinner, StockBadge, useLoad } from '../../components/ui';
import { fmtDate, fmtMoney, fmtQty, MOVEMENT_LABEL, relativeDay } from '../../lib/format';
import { scopeQuery, useManage, useTz } from './context';

export default function Dashboard() {
  const { restaurantId, restaurants } = useManage();
  const tz = useTz();
  const { data, error, loading, reload } = useLoad(() => get<D>(`/dashboard${scopeQuery(restaurantId)}`), [restaurantId]);
  const many = !restaurantId && restaurants.length > 1;

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Dashboard</h1>
        <button onClick={reload} className="text-sm text-navy-500 underline">
          Refresh
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.summary.map((s) => (
          <Card key={s.id}>
            <p className="font-bold text-navy-900">{s.name}</p>
            <p className="text-sm text-navy-500">
              {s.fridges} fridges · {s.items} stocked lines
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 border-y border-navy-100 py-3 text-sm">
              <div>
                <p className="text-navy-500">Stock value</p>
                <p className="text-lg font-black">{fmtMoney(s.stockValueCents)}</p>
              </div>
              <div>
                <p className="text-navy-500">Sales today</p>
                <p className="text-lg font-black">{fmtMoney(s.salesTodayCents)}</p>
              </div>
              <Link to="/manage/accounts" className="hover:underline">
                <p className="text-navy-500">Owed by staff</p>
                <p className={`text-lg font-black ${s.owedCents > 0 ? 'text-beacon-600' : ''}`}>{fmtMoney(s.owedCents)}</p>
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <Stat n={s.out} label="Out" tone="bg-beacon-500 text-white" />
              <Stat n={s.low} label="Low" tone="bg-amber-100 text-amber-900" />
              <Stat n={s.expiring} label="Use soon" tone="bg-orange-100 text-orange-900" />
              <Stat n={s.expired} label="Expired" tone="bg-red-700 text-white" />
            </div>
          </Card>
        ))}
      </div>

      <p className="text-sm text-navy-600">
        Last 24 hours:{' '}
        {Object.keys(data.last24h).length === 0
          ? 'no activity'
          : Object.entries(data.last24h)
              .map(([t, n]) => `${n} ${MOVEMENT_LABEL[t]?.toLowerCase() ?? t}`)
              .join(' · ')}
      </p>

      <section>
        <h2 className="mb-2 text-lg font-bold">Use or bin first</h2>
        {data.expiring.length === 0 ? (
          <Empty>Nothing expiring soon.</Empty>
        ) : (
          <Card className="divide-y divide-navy-100 p-0">
            {data.expiring.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <ExpiryBadge status={b.expiry} />
                <span className="font-semibold">{b.name}</span>
                <span className="text-navy-600">{fmtQty(b.qty, b.unit)}</span>
                <span className="text-sm text-navy-500">
                  {many && `${b.restaurantName} · `}
                  {b.fridgeName}
                </span>
                <span className="ml-auto text-sm">
                  use by {fmtDate(b.expiresAt, tz)} ({relativeDay(b.expiresAt, tz)})
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">Reorder list</h2>
          <Link to="/manage/stock" className="text-sm text-navy-500 underline">
            Set minimums
          </Link>
        </div>
        {data.reorder.length === 0 ? (
          <Empty>Everything is above its minimum.</Empty>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="bg-navy-50 text-navy-600">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Fridge</th>
                  <th className="px-4 py-2 text-right">In stock</th>
                  <th className="px-4 py-2 text-right">Min / par</th>
                  <th className="px-4 py-2 text-right">Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {data.reorder.map((l) => (
                  <tr key={`${l.fridgeId}-${l.itemId}`}>
                    <td className="px-4 py-2">
                      <span className="font-semibold">{l.name}</span> <StockBadge status={l.status} />
                    </td>
                    <td className="px-4 py-2 text-navy-600">
                      {many && `${l.restaurantName} · `}
                      {l.fridgeName}
                    </td>
                    <td className="px-4 py-2 text-right">{fmtQty(l.qty, l.unit)}</td>
                    <td className="px-4 py-2 text-right text-navy-500">
                      {fmtQty(l.minQty, l.unit)} / {fmtQty(l.parLevel, l.unit)}
                    </td>
                    <td className="px-4 py-2 text-right font-bold">{l.reorderQty > 0 ? fmtQty(l.reorderQty, l.unit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`rounded-xl px-1 py-2 ${n > 0 ? tone : 'bg-navy-50 text-navy-400'}`}>
      <p className="text-xl font-black">{n}</p>
      <p className="text-[11px] font-semibold uppercase">{label}</p>
    </div>
  );
}
