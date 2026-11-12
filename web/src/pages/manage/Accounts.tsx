import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../lib/api';
import type { Accounts as A, Payment } from '../../lib/types';
import { Button, Card, cx, Empty, ErrorNote, Field, inputCls, Modal, Spinner, useLoad, useToast } from '../../components/ui';
import { fmtDate, fmtDay, fmtMoney, localDate, parseMoney, PAYMENT_METHOD_LABEL } from '../../lib/format';
import { useVenue, VenuePicker } from './VenuePicker';

/** Who owes what for fridge items, and the money that has come in. */
export default function Accounts() {
  const toast = useToast();
  const [venue, setVenue] = useVenue();
  const acc = useLoad(() => (venue ? get<A>(`/accounts?restaurantId=${venue}`) : Promise.resolve(null)), [venue]);
  const pays = useLoad(() => (venue ? get<Payment[]>(`/payments?restaurantId=${venue}`) : Promise.resolve([])), [venue]);
  const [paying, setPaying] = useState<{ staffId: string; amount: string; method: string; paidOn: string; reference: string } | null>(null);
  const [voiding, setVoiding] = useState<{ p: Payment; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tz = acc.data?.restaurant.timezone ?? 'Africa/Windhoek';
  const owing = (acc.data?.rows ?? []).filter((r) => r.balanceCents !== 0);
  const everyone = acc.data?.rows ?? [];

  const openPay = (staffId = '', balance = 0) =>
    setPaying({ staffId: staffId || everyone[0]?.staffId || '', amount: balance > 0 ? (balance / 100).toFixed(2) : '', method: 'CASH', paidOn: localDate(new Date(), tz), reference: '' });

  const savePayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!paying) return;
    const cents = parseMoney(paying.amount);
    if (!cents) return setError('Enter an amount, e.g. 120.00');
    setError(null);
    try {
      await post('/payments', { restaurantId: venue, staffId: paying.staffId, amountCents: cents, method: paying.method, paidOn: paying.paidOn, reference: paying.reference || undefined });
      toast(`${fmtMoney(cents)} recorded`);
      setPaying(null);
      await Promise.all([acc.reload(), pays.reload()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const voidPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!voiding) return;
    setError(null);
    try {
      await post(`/payments/${voiding.p.id}/void`, { reason: voiding.reason });
      toast('Payment voided');
      setVoiding(null);
      await Promise.all([acc.reload(), pays.reload()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">Staff accounts</h1>
          {acc.data && (
            <p className="text-navy-600">
              Current period {fmtDay(acc.data.currentPeriod.from)} – {fmtDay(acc.data.currentPeriod.to)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <VenuePicker value={venue} onChange={setVenue} />
          <Button onClick={() => openPay()} disabled={!everyone.length}>
            Record payment
          </Button>
          <Link to="/manage/statements" className="inline-flex items-center rounded-xl bg-white px-4 py-2.5 font-semibold text-navy-800 ring-1 ring-navy-200 hover:bg-navy-50">
            Statements
          </Link>
        </div>
      </div>
      <ErrorNote error={acc.error ?? pays.error} />

      {acc.loading && !acc.data ? (
        <Spinner />
      ) : acc.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <p className="text-sm text-navy-600">Owed to the fridge</p>
              <p className="text-3xl font-black text-beacon-600">{fmtMoney(acc.data.totalOwedCents)}</p>
            </Card>
            <Card>
              <p className="text-sm text-navy-600">People owing</p>
              <p className="text-3xl font-black">{owing.filter((r) => r.balanceCents > 0).length}</p>
            </Card>
            <Card>
              <p className="text-sm text-navy-600">Statements run</p>
              <p className="text-3xl font-black">
                {acc.data.restaurant.statementStartDay === 1 ? '1st – end' : `${acc.data.restaurant.statementStartDay}th – ${acc.data.restaurant.statementStartDay - 1}th`}
              </p>
            </Card>
          </div>

          <section>
            <h2 className="mb-2 text-lg font-bold">Balances</h2>
            {everyone.length === 0 ? (
              <Empty>No one has an account here yet.</Empty>
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead className="bg-navy-50 text-navy-600">
                    <tr>
                      <th className="px-4 py-2">Person</th>
                      <th className="px-4 py-2">Last took</th>
                      <th className="px-4 py-2">Last paid</th>
                      <th className="px-4 py-2 text-right">Balance</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {everyone.map((r) => (
                      <tr key={r.staffId}>
                        <td className={cx('px-4 py-2 font-semibold', !r.active && 'text-navy-400')}>
                          {r.name}
                          {!r.active && ' (left)'}
                        </td>
                        <td className="px-4 py-2 text-navy-600">{r.lastChargeOn ? fmtDay(r.lastChargeOn) : '—'}</td>
                        <td className="px-4 py-2 text-navy-600">{r.lastPaymentOn ? fmtDay(r.lastPaymentOn) : '—'}</td>
                        <td className={cx('px-4 py-2 text-right font-bold', r.balanceCents > 0 ? 'text-beacon-600' : r.balanceCents < 0 ? 'text-emerald-700' : 'text-navy-400')}>
                          {r.balanceCents < 0 ? `${fmtMoney(-r.balanceCents)} credit` : fmtMoney(r.balanceCents)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right">
                          <Button size="sm" variant="secondary" onClick={() => openPay(r.staffId, r.balanceCents)}>
                            Payment
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold">Payments received</h2>
            {(pays.data ?? []).length === 0 ? (
              <Empty>No payments recorded yet.</Empty>
            ) : (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead className="bg-navy-50 text-navy-600">
                    <tr>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Person</th>
                      <th className="px-4 py-2">How</th>
                      <th className="px-4 py-2">Reference</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2">Recorded by</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {pays.data!.map((p) => (
                      <tr key={p.id} className={p.voidedAt ? 'text-navy-400' : ''}>
                        <td className="px-4 py-2">{fmtDate(p.paidOn, tz)}</td>
                        <td className="px-4 py-2 font-semibold">{p.staff.name}</td>
                        <td className="px-4 py-2">{PAYMENT_METHOD_LABEL[p.method]}</td>
                        <td className="px-4 py-2">{p.voidedAt ? `VOIDED — ${p.voidReason}` : p.reference ?? ''}</td>
                        <td className={cx('px-4 py-2 text-right font-semibold', p.voidedAt && 'line-through')}>{fmtMoney(p.amountCents)}</td>
                        <td className="px-4 py-2 text-navy-600">{p.recordedBy.name}</td>
                        <td className="px-4 py-2 text-right">
                          {!p.voidedAt && (
                            <Button size="sm" variant="ghost" onClick={() => setVoiding({ p, reason: '' })}>
                              Void
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </section>
        </>
      ) : null}

      <Modal open={!!paying} onClose={() => setPaying(null)} title="Record a payment">
        {paying && (
          <form className="space-y-4" onSubmit={savePayment}>
            <Field label="Person">
              <select value={paying.staffId} onChange={(e) => setPaying({ ...paying, staffId: e.target.value })} className={inputCls}>
                {everyone.map((r) => (
                  <option key={r.staffId} value={r.staffId}>
                    {r.name} — {fmtMoney(r.balanceCents)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (N$)">
                <input value={paying.amount} onChange={(e) => setPaying({ ...paying, amount: e.target.value })} inputMode="decimal" className={inputCls} placeholder="0.00" required />
              </Field>
              <Field label="Date received">
                <input type="date" value={paying.paidOn} max={localDate(new Date(), tz)} onChange={(e) => setPaying({ ...paying, paidOn: e.target.value })} className={inputCls} required />
              </Field>
            </div>
            <Field label="How" hint="Use “Credit / correction” to reverse a wrong charge.">
              <select value={paying.method} onChange={(e) => setPaying({ ...paying, method: e.target.value })} className={inputCls}>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reference (optional)">
              <input value={paying.reference} onChange={(e) => setPaying({ ...paying, reference: e.target.value })} className={inputCls} maxLength={120} placeholder="Receipt no., EFT ref, payroll run…" />
            </Field>
            <ErrorNote error={error} />
            <Button type="submit">Save payment</Button>
          </form>
        )}
      </Modal>

      <Modal open={!!voiding} onClose={() => setVoiding(null)} title="Void this payment?">
        {voiding && (
          <form className="space-y-4" onSubmit={voidPayment}>
            <p className="text-navy-600">
              {fmtMoney(voiding.p.amountCents)} from {voiding.p.staff.name}. It stays on record marked as voided and no longer counts towards the balance.
            </p>
            <Field label="Why">
              <input value={voiding.reason} onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })} className={inputCls} required minLength={3} maxLength={200} />
            </Field>
            <ErrorNote error={error} />
            <Button type="submit" variant="danger">
              Void payment
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
