import { useState } from 'react';
import {
  fmtDate,
  fmtDateTime,
  fmtTime,
  formatMoney,
  monthReport,
  periodKeyOf,
  periodLabel,
  reportCsv,
  shiftKey,
  takesCsv,
  amountOf,
} from './model';
import { Button, Empty, download, useCtx } from './ui';

/** Who took what this month: a summary, each person's lines, every take with its date. Prints. */
export function ReportTab() {
  const { data } = useCtx();
  const current = periodKeyOf(new Date(), data.settings.monthStartDay);
  const [key, setKey] = useState(current);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [perPage, setPerPage] = useState(false);
  const r = monthReport(data, key);
  const label = periodLabel(r.period);
  const item = (id: string) => data.items.find((i) => i.id === id)?.name ?? 'Removed item';
  const file = `${data.settings.fridgeName.replace(/[^\w-]+/g, '-')}-${key}`;
  const allOpen = r.people.length > 0 && r.people.every((p) => open[p.personId]);

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button kind="ghost" aria-label="Previous month" onClick={() => setKey(shiftKey(key, -1))}>
            ‹
          </Button>
          <h2 className="min-w-0 text-center text-xl font-black text-navy-900">{label}</h2>
          <Button kind="ghost" aria-label="Next month" disabled={key >= current} onClick={() => setKey(shiftKey(key, 1))}>
            ›
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => window.print()} disabled={r.people.length === 0}>
            Print / PDF
          </Button>
          <Button onClick={() => download(`${file}-summary.csv`, reportCsv(r), 'text/csv')} disabled={r.people.length === 0}>
            CSV summary
          </Button>
          <Button onClick={() => download(`${file}-all-takes.csv`, takesCsv(data, r), 'text/csv')} disabled={r.people.length === 0}>
            CSV every take
          </Button>
        </div>
      </div>

      {/* Printed heading */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-black">{data.settings.fridgeName} — who took what</h1>
        <p>
          {label} · printed {fmtDateTime(new Date())}
        </p>
      </div>

      {r.people.length === 0 ? (
        <Empty>Nothing was taken in {label}.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="People" value={String(r.people.length)} />
            <Stat label="Items taken" value={String(r.qty)} />
            <Stat label="Total" value={formatMoney(r.amountCents)} />
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-lg font-black text-navy-900">Per person</h3>
              <button
                type="button"
                className="no-print text-sm font-bold text-navy-700 underline"
                onClick={() => setOpen(allOpen ? {} : Object.fromEntries(r.people.map((p) => [p.personId, true])))}
              >
                {allOpen ? 'Hide details' : 'Show all details'}
              </button>
            </div>
            <div className="space-y-3">
              {r.people.map((p) => {
                const isOpen = !!open[p.personId];
                return (
                  <article
                    key={p.personId}
                    className={`report-person rounded-2xl border border-navy-200 bg-white ${perPage ? 'page-each' : ''}`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                      onClick={() => setOpen((o) => ({ ...o, [p.personId]: !isOpen }))}
                      aria-expanded={isOpen}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-lg font-black text-navy-900">{p.name}</span>
                        <span className="block text-sm text-navy-600">
                          {p.lines.map((l) => `${l.qty} × ${l.itemName}`).join(', ')}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-lg font-black tabular-nums text-navy-900">{formatMoney(p.amountCents)}</span>
                        <span className="block text-sm text-navy-600">{p.qty} item{p.qty === 1 ? '' : 's'}</span>
                      </span>
                      <span className="no-print text-navy-400">{isOpen ? '▴' : '▾'}</span>
                    </button>
                    <div className={`${isOpen ? '' : 'hidden'} print:block border-t border-navy-100 px-4 py-3`}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-navy-600">
                            <th className="py-1 font-bold">Date</th>
                            <th className="py-1 font-bold">Item</th>
                            <th className="py-1 text-right font-bold">Qty</th>
                            <th className="py-1 text-right font-bold">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums">
                          {p.takes.map((t) => (
                            <tr key={t.id} className="border-t border-navy-100">
                              <td className="py-1 pr-2 whitespace-nowrap">
                                {fmtDate(new Date(t.at))} <span className="text-navy-600">{fmtTime(new Date(t.at))}</span>
                              </td>
                              <td className="py-1 pr-2">{item(t.itemId)}</td>
                              <td className="py-1 text-right">{t.qty}</td>
                              <td className="py-1 text-right">{amountOf(t) ? formatMoney(amountOf(t)) : '—'}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-navy-800 font-black">
                            <td className="py-1" colSpan={2}>
                              Total
                            </td>
                            <td className="py-1 text-right">{p.qty}</td>
                            <td className="py-1 text-right">{formatMoney(p.amountCents)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
            </div>
            <label className="no-print mt-3 flex items-center gap-2 text-sm text-navy-700">
              <input type="checkbox" className="h-4 w-4" checked={perPage} onChange={(e) => setPerPage(e.target.checked)} />
              When printing, start each person on a new page
            </label>
          </section>

          <section className="report-items">
            <h3 className="mb-2 text-lg font-black text-navy-900">Per item</h3>
            <table className="w-full overflow-hidden rounded-2xl border border-navy-200 bg-white text-sm">
              <thead>
                <tr className="bg-navy-50 text-left text-navy-700">
                  <th className="px-3 py-2 font-bold">Item</th>
                  <th className="px-3 py-2 text-right font-bold">Taken</th>
                  <th className="px-3 py-2 text-right font-bold">Amount</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {r.items.map((l) => (
                  <tr key={l.itemId} className="border-t border-navy-100">
                    <td className="px-3 py-2">{l.itemName}</td>
                    <td className="px-3 py-2 text-right">{l.qty}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(l.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-navy-200 bg-white p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-navy-600">{label}</div>
      <div className="mt-1 break-words text-lg font-black tabular-nums text-navy-900 sm:text-2xl">{value}</div>
    </div>
  );
}
