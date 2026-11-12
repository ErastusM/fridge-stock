import { useState } from 'react';
import { downloadCsv, get } from '../../lib/api';
import type { Fridge, Usage } from '../../lib/types';
import { Button, Card, Empty, ErrorNote, Field, inputCls, Spinner, useLoad } from '../../components/ui';
import { addDays, fmtQty, localDate } from '../../lib/format';
import { scopeQuery, useManage, useTz } from './context';
import { FridgePicker } from './FridgePicker';

export default function Reports() {
  const { restaurantId } = useManage();
  const tz = useTz();
  const today = localDate(new Date(), tz);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [fridgeId, setFridgeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fridges = useLoad(() => get<Fridge[]>(`/fridges${scopeQuery(restaurantId)}`), [restaurantId]);
  const q = scopeQuery(restaurantId, { from, to, fridgeId });
  const usage = useLoad(() => get<Usage>(`/reports/usage${q}`), [q]);
  const days = [...new Set((usage.data?.daily ?? []).map((d) => d.date))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black">Usage &amp; waste</h1>
        <Button
          variant="secondary"
          onClick={async () => {
            setError(null);
            try {
              await downloadCsv(`/reports/usage.csv${q}`, 'usage.csv');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Download CSV
        </Button>
      </div>
      <Card className="flex flex-wrap items-end gap-3">
        <Field label="Fridge">
          <FridgePicker fridges={fridges.data ?? []} value={fridgeId} onChange={setFridgeId} allowAll />
        </Field>
        <Field label="From">
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </Field>
        <Field label="To">
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex gap-2">
          {[
            ['Today', 0],
            ['7 days', 6],
            ['30 days', 29],
          ].map(([l, n]) => (
            <Button
              key={l}
              size="sm"
              variant="ghost"
              onClick={() => {
                setFrom(addDays(today, -Number(n)));
                setTo(today);
              }}
            >
              {l}
            </Button>
          ))}
        </div>
      </Card>
      <ErrorNote error={error ?? usage.error} />
      {usage.loading && !usage.data ? (
        <Spinner />
      ) : !usage.data || usage.data.totals.length === 0 ? (
        <Empty>Nothing taken, wasted or put in during this period.</Empty>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="overflow-x-auto p-0 lg:col-span-2">
              <h2 className="px-4 pt-3 font-bold">Totals per item</h2>
              <table className="w-full text-left text-sm">
                <thead className="text-navy-600">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-right">Taken</th>
                    <th className="px-4 py-2 text-right">Wasted</th>
                    <th className="px-4 py-2 text-right">Waste %</th>
                    <th className="px-4 py-2 text-right">Put in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {usage.data.totals.map((t) => {
                    const used = t.taken + t.wasted;
                    const pct = used > 0 ? Math.round((t.wasted / used) * 100) : 0;
                    return (
                      <tr key={t.itemId}>
                        <td className="px-4 py-2">
                          <span className="font-semibold">{t.name}</span> <span className="text-xs text-navy-500">{t.category}</span>
                        </td>
                        <td className="px-4 py-2 text-right">{t.taken ? fmtQty(t.taken, t.unit) : '—'}</td>
                        <td className="px-4 py-2 text-right">{t.wasted ? fmtQty(t.wasted, t.unit) : '—'}</td>
                        <td className={`px-4 py-2 text-right font-semibold ${pct >= 10 ? 'text-beacon-600' : 'text-navy-500'}`}>{t.wasted ? `${pct}%` : '—'}</td>
                        <td className="px-4 py-2 text-right text-navy-600">{t.added ? fmtQty(t.added, t.unit) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            <Card>
              <h2 className="mb-2 font-bold">Why things were thrown away</h2>
              {usage.data.wasteReasons.length === 0 ? (
                <p className="text-navy-500">No waste recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {usage.data.wasteReasons.map((w) => {
                    const max = usage.data!.wasteReasons[0].count;
                    return (
                      <li key={w.reason}>
                        <div className="flex justify-between text-sm">
                          <span>{w.reason}</span>
                          <span className="font-semibold">{w.count}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-navy-50">
                          <div className="h-2 rounded-full bg-beacon-500" style={{ width: `${(w.count / max) * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
          {days.length > 1 && (
            <Card className="overflow-x-auto p-0">
              <h2 className="px-4 pt-3 font-bold">Taken per day</h2>
              <table className="w-full text-left text-sm">
                <thead className="text-navy-600">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    {days.map((d) => (
                      <th key={d} className="whitespace-nowrap px-3 py-2 text-right">
                        {d.slice(8, 10)}/{d.slice(5, 7)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {usage.data.totals.map((t) => (
                    <tr key={t.itemId}>
                      <td className="whitespace-nowrap px-4 py-2 font-semibold">{t.name}</td>
                      {days.map((d) => {
                        const r = usage.data!.daily.find((x) => x.date === d && x.itemId === t.itemId);
                        return (
                          <td key={d} className="px-3 py-2 text-right text-navy-700">
                            {r?.taken ? fmtQty(r.taken, t.unit) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
