import { FormEvent, useEffect, useMemo, useState } from 'react';
import { get, post } from '../../lib/api';
import type { Fridge, StaffMember, StockLine } from '../../lib/types';
import { Button, Card, cx, ErrorNote, Field, inputCls, useLoad, useToast } from '../../components/ui';
import { addDays, fmtMoney, fmtQty, localDate, UNIT_LABEL, Unit } from '../../lib/format';
import { scopeQuery, useManage, useTz } from './context';
import { FridgePicker } from './FridgePicker';

type Mode = 'ADD' | 'TAKE' | 'WASTE';
const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'ADD', label: 'Receive a delivery', hint: 'Stock arriving from a supplier.' },
  { mode: 'TAKE', label: 'Record a take for someone', hint: 'When someone forgot to use the tablet. Priced items are charged to them.' },
  { mode: 'WASTE', label: 'Record waste', hint: 'Spoiled, expired or broken stock.' },
];

/** Back-office entry, for when the tablet was not used. Every line says who entered it. */
export default function Receive() {
  const { restaurantId, user } = useManage();
  const tz = useTz();
  const toast = useToast();
  const fridges = useLoad(() => get<Fridge[]>(`/fridges${scopeQuery(restaurantId)}`), [restaurantId]);
  const [fridgeId, setFridgeId] = useState('');
  const fridge = fridges.data?.find((f) => f.id === fridgeId);
  const lines = useLoad(() => (fridgeId ? get<StockLine[]>(`/fridges/${fridgeId}/items`) : Promise.resolve([])), [fridgeId]);
  const staff = useLoad(() => (fridge ? get<StaffMember[]>(`/staff?restaurantId=${fridge.restaurantId}`) : Promise.resolve([])), [fridge?.restaurantId]);
  const [mode, setMode] = useState<Mode>('ADD');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [supplier, setSupplier] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [staffId, setStaffId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const line = lines.data?.find((l) => l.itemId === itemId);
  const q = Number(qty.replace(',', '.'));

  useEffect(() => setItemId(''), [fridgeId]);
  useEffect(() => {
    if (line) setExpiresOn(addDays(localDate(new Date(), tz), line.defaultShelfLifeDays));
  }, [line?.itemId, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => (staff.data ?? []).filter((s) => s.active), [staff.data]);
  const charge = mode === 'TAKE' && line?.priceCents && q > 0 ? Math.round(q * line.priceCents) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/movements', {
        fridgeId,
        itemId,
        type: mode,
        qty: q,
        ...(mode === 'ADD' ? { supplier: supplier || undefined, expiresOn } : {}),
        ...(mode === 'TAKE' ? { staffId: staffId || undefined } : {}),
        ...(mode === 'WASTE' ? { reason } : {}),
      });
      toast(`${MODES.find((m) => m.mode === mode)!.label.split(' ')[0]}: ${fmtQty(q, line!.unit)} × ${line!.name}${charge ? ` — ${fmtMoney(charge)} charged` : ''}`);
      setQty('');
      setReason('');
      await lines.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">Receive &amp; record</h1>
      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.mode}
            onClick={() => setMode(m.mode)}
            className={cx('rounded-2xl p-4 text-left ring-2', mode === m.mode ? 'bg-navy-800 text-white ring-navy-800' : 'bg-white ring-navy-100 hover:ring-navy-200')}
          >
            <p className="font-bold">{m.label}</p>
            <p className={cx('text-sm', mode === m.mode ? 'text-navy-100' : 'text-navy-500')}>{m.hint}</p>
          </button>
        ))}
      </div>
      <Card>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Field label="Fridge">
            <FridgePicker fridges={fridges.data ?? []} value={fridgeId} onChange={setFridgeId} />
          </Field>
          <Field label="Item">
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls} required>
              <option value="">Choose…</option>
              {(lines.data ?? []).map((l) => (
                <option key={l.itemId} value={l.itemId}>
                  {l.name} — {fmtQty(l.qty, l.unit)} in stock{l.priceCents ? ` · ${fmtMoney(l.priceCents)}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Quantity${line ? ` (${UNIT_LABEL[line.unit as Unit] ?? line.unit})` : ''}`}>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={inputCls} required />
          </Field>
          {mode === 'ADD' && (
            <>
              <Field label="Supplier (optional)">
                <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputCls} maxLength={120} placeholder="e.g. Namibia Breweries" />
              </Field>
              <Field label="Use by">
                <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className={inputCls} required />
              </Field>
            </>
          )}
          {mode === 'TAKE' && (
            <Field label="Who took it">
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls} required>
                <option value="">Choose…</option>
                {people.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.id === user.id ? ' (me)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {mode === 'WASTE' && (
            <Field label="Why">
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} required maxLength={200} placeholder="Expired, spoiled, broken…" />
            </Field>
          )}
          <div className="flex items-end gap-3 sm:col-span-2">
            <Button type="submit" disabled={busy || !itemId || !(q > 0)}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            {charge !== null && <p className="pb-2 font-semibold text-beacon-600">{fmtMoney(charge)} will be charged to their account</p>}
          </div>
          <div className="sm:col-span-2">
            <ErrorNote error={error ?? lines.error} />
          </div>
        </form>
      </Card>
      <p className="text-sm text-navy-500">The history shows these lines with your name as “entered by”, so they can be told apart from what was recorded at the fridge.</p>
    </div>
  );
}
