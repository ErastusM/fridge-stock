import { useEffect, useMemo, useState } from 'react';
import { Modal, cx, ExpiryBadge } from '../../components/ui';
import { PinPad } from './PinPad';
import { addDays, fmtDate, fmtMoney, fmtQty, isCounted, localDate, relativeDay, UNIT_LABEL, Unit } from '../../lib/format';
import type { StockLine } from '../../lib/types';

export type Action = 'TAKE' | 'ADD' | 'WASTE' | 'TRANSFER';

export interface ActionRequest {
  type: Action;
  qty: number;
  pin: string;
  expiresOn?: string;
  reason?: string;
  toFridgeId?: string;
}

const ACTIONS: { type: Action; label: string; cls: string; icon: string }[] = [
  { type: 'TAKE', label: 'Take out', cls: 'bg-navy-800 text-white', icon: '↑' },
  { type: 'ADD', label: 'Put in', cls: 'bg-emerald-700 text-white', icon: '↓' },
  { type: 'WASTE', label: 'Throw away', cls: 'bg-beacon-500 text-white', icon: '🗑' },
  { type: 'TRANSFER', label: 'Move to…', cls: 'bg-white text-navy-800 ring-2 ring-navy-200', icon: '⇄' },
];
const WASTE_REASONS = ['Expired', 'Spoiled', 'Dropped / damaged', 'Returned by guest', 'Other'];
const VERB: Record<Action, string> = { TAKE: 'Take', ADD: 'Put in', WASTE: 'Throw away', TRANSFER: 'Move' };

export function ActionSheet({
  line,
  tz,
  otherFridges,
  onClose,
  onSubmit,
}: {
  line: StockLine | null;
  tz: string;
  otherFridges: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (r: ActionRequest) => Promise<string | null>;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [step, setStep] = useState<'details' | 'pin'>('details');
  const [qtyText, setQtyText] = useState('1');
  const [expiresOn, setExpiresOn] = useState('');
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [toFridgeId, setToFridgeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAction(null);
    setStep('details');
    setQtyText('1');
    setReason('');
    setOtherReason('');
    setToFridgeId('');
    setError(null);
    if (line) setExpiresOn(addDays(localDate(new Date(), tz), line.defaultShelfLifeDays));
    // Reset only when a different item is opened — a background refresh of the same item must
    // not wipe what someone is halfway through entering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.itemId, tz]);

  // An idle sheet closes itself, so the next person doesn't inherit it.
  const open = !!line;
  useEffect(() => {
    if (!open) return;
    let t = setTimeout(onClose, 60_000);
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(onClose, 60_000);
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [open, line?.itemId, onClose]);

  const unit = line?.unit ?? 'EACH';
  const counted = isCounted(unit);
  const step1 = counted ? 1 : 0.5;
  const qty = Number(qtyText.replace(',', '.'));
  const quick = counted ? [1, 2, 5, 10] : [0.25, 0.5, 1, 2];

  const detailError = useMemo(() => {
    if (!line || !action) return null;
    if (!Number.isFinite(qty) || qty <= 0) return 'Enter a quantity';
    if (counted && !Number.isInteger(qty)) return `Whole ${UNIT_LABEL[unit as Unit] ?? 'units'} only`;
    if (action !== 'ADD' && qty > line.qty) return `Only ${fmtQty(line.qty, unit)} in this fridge`;
    if (action === 'WASTE' && !reason) return 'Choose a reason';
    if (action === 'WASTE' && reason === 'Other' && !otherReason.trim()) return 'Say what happened';
    if (action === 'TRANSFER' && !toFridgeId) return 'Choose a fridge';
    if (action === 'ADD' && !expiresOn) return 'Choose a use-by date';
    return null;
  }, [line, action, qty, counted, unit, reason, otherReason, toFridgeId, expiresOn]);

  if (!line) return null;

  const bump = (d: number) => {
    const next = Math.max(0, Math.round(((Number.isFinite(qty) ? qty : 0) + d) * 1000) / 1000);
    setQtyText(String(next));
  };

  const submit = async (pin: string) => {
    if (!action) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit({
      type: action,
      qty,
      pin,
      expiresOn: action === 'ADD' ? expiresOn : undefined,
      reason: action === 'WASTE' ? (reason === 'Other' ? otherReason.trim() : reason) : undefined,
      toFridgeId: action === 'TRANSFER' ? toFridgeId : undefined,
    });
    setBusy(false);
    if (err) setError(err);
  };

  const canTake = line.qty > 0;

  return (
    <Modal open={!!line} onClose={onClose} title={line.name} wide>
      <div className="kiosk space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-navy-700">
          <span className="text-3xl font-black text-navy-900">{fmtQty(line.qty, unit)}</span>
          <span>in this fridge</span>
          {line.priceCents !== null && <span className="rounded-md bg-beacon-500 px-2 py-0.5 text-sm font-bold text-white">{fmtMoney(line.priceCents)} each</span>}
          <ExpiryBadge status={line.expiry} />
        </div>

        {!action && (
          <>
            {line.batches.length > 0 && (
              <div className="rounded-2xl bg-sand-100 p-3 text-sm">
                <p className="mb-1 font-semibold text-navy-800">Use the oldest first</p>
                <ul className="space-y-1">
                  {line.batches.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2">
                      <span>
                        {fmtQty(b.qty, unit)} — use by {fmtDate(b.expiresAt, tz)} ({relativeDay(b.expiresAt, tz)})
                      </span>
                      <ExpiryBadge status={b.expiry} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {ACTIONS.map((a) => {
                const disabled = a.type !== 'ADD' && (!canTake || (a.type === 'TRANSFER' && otherFridges.length === 0));
                return (
                  <button
                    key={a.type}
                    disabled={disabled}
                    onClick={() => {
                      setAction(a.type);
                      setQtyText(a.type === 'WASTE' && line.expiry === 'EXPIRED' ? String(line.batches.filter((b) => b.expiry === 'EXPIRED').reduce((s, b) => s + b.qty, 0)) : '1');
                      if (a.type === 'WASTE' && line.expiry === 'EXPIRED') setReason('Expired');
                    }}
                    className={cx('flex h-24 flex-col items-center justify-center rounded-2xl text-xl font-bold active:scale-95 disabled:opacity-30', a.cls)}
                  >
                    <span className="text-2xl" aria-hidden>
                      {a.icon}
                    </span>
                    {a.label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {action && step === 'details' && (
          <div className="space-y-5">
            <div>
              <p className="mb-2 font-semibold text-navy-800">How much? ({UNIT_LABEL[unit as Unit] ?? unit})</p>
              <div className="flex items-center gap-3">
                <button onClick={() => bump(-step1)} className="h-16 w-16 rounded-2xl bg-navy-50 text-3xl font-bold" aria-label="Less">
                  −
                </button>
                <input
                  value={qtyText}
                  onChange={(e) => setQtyText(e.target.value)}
                  inputMode={counted ? 'numeric' : 'decimal'}
                  className="h-16 w-32 rounded-2xl text-center text-3xl font-black ring-2 ring-navy-200 focus:outline-none focus:ring-navy-500"
                  aria-label="Quantity"
                />
                <button onClick={() => bump(step1)} className="h-16 w-16 rounded-2xl bg-navy-50 text-3xl font-bold" aria-label="More">
                  +
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {quick.map((q) => (
                  <button key={q} onClick={() => setQtyText(String(q))} className="rounded-xl bg-white px-4 py-2 font-semibold ring-1 ring-navy-200">
                    {q}
                  </button>
                ))}
                {action !== 'ADD' && (
                  <button onClick={() => setQtyText(String(line.qty))} className="rounded-xl bg-white px-4 py-2 font-semibold ring-1 ring-navy-200">
                    All ({fmtQty(line.qty, unit)})
                  </button>
                )}
              </div>
            </div>

            {action === 'ADD' && (
              <div>
                <p className="mb-2 font-semibold text-navy-800">Use by</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={expiresOn}
                    min={localDate(new Date(), tz)}
                    onChange={(e) => setExpiresOn(e.target.value)}
                    className="h-14 rounded-2xl px-3 text-lg ring-2 ring-navy-200"
                  />
                  {[1, 2, 3, 5, 7].map((n) => (
                    <button key={n} onClick={() => setExpiresOn(addDays(localDate(new Date(), tz), n))} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold ring-1 ring-navy-200">
                      +{n}d
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-sm text-navy-500">Check the label. Default is {line.defaultShelfLifeDays} days from today.</p>
              </div>
            )}

            {action === 'WASTE' && (
              <div>
                <p className="mb-2 font-semibold text-navy-800">Why?</p>
                <div className="flex flex-wrap gap-2">
                  {WASTE_REASONS.map((r) => (
                    <button key={r} onClick={() => setReason(r)} className={cx('rounded-xl px-4 py-3 font-semibold ring-1', reason === r ? 'bg-beacon-500 text-white ring-beacon-500' : 'bg-white ring-navy-200')}>
                      {r}
                    </button>
                  ))}
                </div>
                {reason === 'Other' && (
                  <input value={otherReason} onChange={(e) => setOtherReason(e.target.value)} maxLength={200} placeholder="What happened?" className="mt-3 h-12 w-full rounded-xl px-3 ring-2 ring-navy-200" />
                )}
              </div>
            )}

            {action === 'TRANSFER' && (
              <div>
                <p className="mb-2 font-semibold text-navy-800">Move to</p>
                <div className="flex flex-wrap gap-2">
                  {otherFridges.map((f) => (
                    <button key={f.id} onClick={() => setToFridgeId(f.id)} className={cx('rounded-xl px-4 py-3 font-semibold ring-1', toFridgeId === f.id ? 'bg-navy-800 text-white ring-navy-800' : 'bg-white ring-navy-200')}>
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="font-semibold text-red-700">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setAction(null)} className="h-16 flex-1 rounded-2xl bg-navy-50 text-lg font-bold text-navy-700">
                Back
              </button>
              <button
                disabled={!!detailError}
                onClick={() => {
                  setError(null);
                  setStep('pin');
                }}
                className="h-16 flex-[2] rounded-2xl bg-navy-800 text-lg font-bold text-white disabled:bg-navy-200"
              >
                {detailError ?? `${VERB[action]} ${fmtQty(qty, unit)}`}
              </button>
            </div>
          </div>
        )}

        {action && step === 'pin' && (
          <div>
            {action === 'TAKE' && line.priceCents !== null && (
              <p className="mb-3 text-center text-lg font-bold text-beacon-600">{fmtMoney(Math.round(qty * line.priceCents))} will be charged to you</p>
            )}
            <PinPad onSubmit={submit} busy={busy} error={error} label={`${VERB[action]} ${fmtQty(qty, unit)} — enter your PIN`} />
            <button onClick={() => setStep('details')} className="mx-auto mt-3 block text-navy-500 underline">
              Change details
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
