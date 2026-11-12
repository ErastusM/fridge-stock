import { useState } from 'react';
import { downloadCsv, get } from '../../lib/api';
import type { Accounts, Statement, Statements as S } from '../../lib/types';
import { Button, Card, Empty, ErrorNote, Field, inputCls, Spinner, useLoad } from '../../components/ui';
import { fmtDateTime, fmtDay, fmtMoney, fmtQty, localDate, monthLabel, periodMonthFor, PAYMENT_METHOD_LABEL, statementPeriod } from '../../lib/format';
import { useVenue, VenuePicker } from './VenuePicker';

/** Print-ready staff statements for one period (16th–15th by default). */
export default function Statements() {
  const [venue, setVenue] = useVenue();
  const acc = useLoad(() => (venue ? get<Accounts>(`/accounts?restaurantId=${venue}`) : Promise.resolve(null)), [venue]);
  const startDay = acc.data?.restaurant.statementStartDay ?? 16;
  const tz = acc.data?.restaurant.timezone ?? 'Africa/Windhoek';
  const [month, setMonth] = useState(() => periodMonthFor(localDate(), 16));
  const [staffId, setStaffId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = `?restaurantId=${venue}&month=${month}${staffId ? `&staffId=${staffId}` : ''}`;
  const st = useLoad(() => (venue ? get<S>(`/statements${q}`) : Promise.resolve(null)), [q]);
  const period = (() => {
    try {
      return statementPeriod(month, startDay);
    } catch {
      return null;
    }
  })();

  return (
    <div className="space-y-4">
      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black">Statements</h1>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => downloadCsv(`/statements.csv${q}`, 'statements.csv').catch((e) => setError((e as Error).message))}>
              Download CSV
            </Button>
            <Button onClick={() => window.print()} disabled={!st.data?.statements.length}>
              Print / save as PDF
            </Button>
          </div>
        </div>
        <Card className="flex flex-wrap items-end gap-3">
          <VenuePicker value={venue} onChange={setVenue} />
          <Field label="Period ending">
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Person">
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls}>
              <option value="">Everyone with activity or a balance</option>
              {(acc.data?.rows ?? []).map((r) => (
                <option key={r.staffId} value={r.staffId}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          {period && (
            <p className="pb-2 text-sm text-navy-600">
              {fmtDay(period.from)} – {fmtDay(period.to)} inclusive
            </p>
          )}
        </Card>
        <ErrorNote error={error ?? st.error} />
        {st.data && st.data.statements.length > 1 && (
          <Card className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-sm text-navy-600">Purchases this period</p>
              <p className="text-2xl font-black">{fmtMoney(st.data.totals.purchasesCents)}</p>
            </div>
            <div>
              <p className="text-sm text-navy-600">Payments this period</p>
              <p className="text-2xl font-black">{fmtMoney(st.data.totals.paidCents)}</p>
            </div>
            <div>
              <p className="text-sm text-navy-600">Total due</p>
              <p className="text-2xl font-black text-beacon-600">{fmtMoney(st.data.totals.closingCents)}</p>
            </div>
          </Card>
        )}
      </div>

      {st.loading && !st.data ? (
        <Spinner />
      ) : !st.data || st.data.statements.length === 0 ? (
        <Empty>Nothing was charged or paid in this period, and nobody owes anything.</Empty>
      ) : (
        <div className="space-y-6">
          {st.data.statements.map((s) => (
            <StatementSheet key={s.staff.id} s={s} data={st.data!} tz={tz} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatementSheet({ s, data, tz }: { s: Statement; data: S; tz: string }) {
  return (
    <article className="statement-sheet rounded-2xl bg-white p-6 shadow-sm ring-1 ring-navy-100 print:rounded-none print:p-0 print:shadow-none print:ring-0">
      <header className="flex items-start justify-between gap-4 border-b-4 border-beacon-500 pb-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-beacon-600">Fridge account statement</p>
          <h2 className="text-2xl font-black text-navy-900">{s.staff.name}</h2>
          <p className="text-navy-600">{data.restaurant.name}</p>
        </div>
        <div className="text-right text-sm text-navy-600">
          <p className="font-semibold text-navy-900">{monthLabel(data.period.month)}</p>
          <p>
            {fmtDay(data.period.from)} – {fmtDay(data.period.to)}
          </p>
          <p className="text-xs">Issued {fmtDateTime(data.generatedAt, tz)}</p>
        </div>
      </header>

      <table className="mt-4 w-full text-left text-sm">
        <thead className="text-navy-600">
          <tr className="border-b border-navy-100">
            <th className="py-2">Date</th>
            <th className="py-2">Item</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Price</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-50">
          <tr>
            <td className="py-1.5" colSpan={4}>
              Balance brought forward
            </td>
            <td className="py-1.5 text-right">{fmtMoney(s.openingCents)}</td>
          </tr>
          {s.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1.5">{fmtDay(l.date)}</td>
              <td className="py-1.5">
                {l.item} <span className="text-xs text-navy-500">· {l.fridge}</span>
              </td>
              <td className="py-1.5 text-right">{fmtQty(l.qty, l.unit)}</td>
              <td className="py-1.5 text-right">{l.unitPriceCents === null ? '' : fmtMoney(l.unitPriceCents)}</td>
              <td className="py-1.5 text-right">{fmtMoney(l.amountCents)}</td>
            </tr>
          ))}
          {s.payments.map((p, i) => (
            <tr key={`p${i}`} className="text-emerald-800">
              <td className="py-1.5">{fmtDay(p.date)}</td>
              <td className="py-1.5" colSpan={3}>
                Payment — {PAYMENT_METHOD_LABEL[p.method]}
                {p.reference ? ` (${p.reference})` : ''}
              </td>
              <td className="py-1.5 text-right">−{fmtMoney(p.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <dt>Opening balance</dt>
          <dd>{fmtMoney(s.openingCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Purchases this period</dt>
          <dd>{fmtMoney(s.purchasesCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Payments this period</dt>
          <dd>−{fmtMoney(s.paidCents)}</dd>
        </div>
        <div className="flex justify-between border-t-2 border-navy-800 pt-2 text-lg font-black">
          <dt>{s.closingCents < 0 ? 'In credit' : 'Balance due'}</dt>
          <dd className={s.closingCents > 0 ? 'text-beacon-600' : ''}>{fmtMoney(Math.abs(s.closingCents))}</dd>
        </div>
      </dl>
      <p className="mt-6 text-xs text-navy-500">Every line was recorded at the fridge with the person's own PIN, at the price on that day. Please settle your fridge account. Thank you.</p>
    </article>
  );
}
