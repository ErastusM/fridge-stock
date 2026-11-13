import { useState } from 'react';
import { addItem, formatMoney, parseMoney, recordCount, recordRestock, stockState, updateItem, type Item } from './model';
import { Badge, Button, Empty, ErrorLine, Field, inputCls, Modal, useCtx, useFormError } from './ui';

type Dialog = { kind: 'add' } | { kind: 'edit' | 'restock' | 'count'; item: Item };

export function FridgeTab() {
  const { data } = useCtx();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [showOld, setShowOld] = useState(false);
  const active = data.items.filter((i) => i.active).sort((a, b) => a.name.localeCompare(b.name));
  const old = data.items.filter((i) => !i.active);
  const low = active.filter((i) => stockState(i) !== 'OK');
  const value = active.reduce((n, i) => n + Math.max(0, i.stock) * (i.priceCents ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-navy-900">In the fridge</h2>
          <p className="text-sm text-navy-600">
            {active.reduce((n, i) => n + Math.max(0, i.stock), 0)} units · worth {formatMoney(value)}
          </p>
        </div>
        <Button kind="primary" onClick={() => setDialog({ kind: 'add' })}>
          + Add item
        </Button>
      </div>

      {low.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3">
          <p className="font-bold text-amber-900">Buy more: {low.map((i) => i.name).join(', ')}</p>
        </div>
      )}

      {active.length === 0 ? (
        <Empty>Nothing yet. Add the drinks and snacks kept in the fridge, with their price if people pay for them.</Empty>
      ) : (
        <ul className="divide-y divide-navy-100 rounded-2xl border border-navy-200 bg-white">
          {active.map((i) => {
            const st = stockState(i);
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-bold text-navy-900">
                    {i.name}
                    {st === 'OUT' && <Badge tone="red">Out</Badge>}
                    {st === 'LOW' && <Badge tone="amber">Low</Badge>}
                  </div>
                  <div className="text-sm text-navy-600">
                    {i.priceCents ? formatMoney(i.priceCents) : 'No charge'}
                    {i.lowAt > 0 && ` · low at ${i.lowAt}`}
                  </div>
                </div>
                <div className={`w-14 text-right text-2xl font-black tabular-nums ${i.stock <= 0 ? 'text-beacon-600' : 'text-navy-900'}`}>
                  {i.stock}
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button className="flex-1 sm:flex-none" onClick={() => setDialog({ kind: 'restock', item: i })}>
                    Restock
                  </Button>
                  <Button className="flex-1 sm:flex-none" onClick={() => setDialog({ kind: 'count', item: i })}>
                    Count
                  </Button>
                  <Button kind="ghost" className="flex-1 sm:flex-none" onClick={() => setDialog({ kind: 'edit', item: i })}>
                    Edit
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {old.length > 0 && (
        <div>
          <button type="button" className="text-sm font-bold text-navy-700 underline" onClick={() => setShowOld((v) => !v)}>
            {showOld ? 'Hide' : 'Show'} items no longer stocked ({old.length})
          </button>
          {showOld && (
            <ul className="mt-2 divide-y divide-navy-100 rounded-2xl border border-navy-200 bg-white">
              {old.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2 text-navy-600">
                  {i.name}
                  <Button kind="ghost" onClick={() => setDialog({ kind: 'edit', item: i })}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialog?.kind === 'add' && <ItemDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <ItemDialog item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'restock' && <StockDialog mode="restock" item={dialog.item} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'count' && <StockDialog mode="count" item={dialog.item} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ItemDialog({ item, onClose }: { item?: Item; onClose: () => void }) {
  const { update } = useCtx();
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(item?.priceCents != null ? (item.priceCents / 100).toFixed(2) : '');
  const [stock, setStock] = useState('0');
  const [lowAt, setLowAt] = useState(String(item?.lowAt ?? 0));
  const [active, setActive] = useState(item?.active ?? true);
  const { error, run } = useFormError();

  const save = () =>
    run(() => {
      const priceCents = parseMoney(price);
      const low = Number(lowAt || 0);
      if (item) update((d) => updateItem(d, item.id, { name, priceCents, lowAt: low, active }));
      else update((d) => addItem(d, { name, priceCents, stock: Number(stock || 0), lowAt: low }));
    }) && onClose();

  return (
    <Modal title={item ? `Edit ${item.name}` : 'Add an item'} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name">
          <input className={inputCls} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coke 330ml" />
        </Field>
        <Field label="Price (N$)" hint="Leave empty if it is free. A new price applies from now on; past takes keep theirs.">
          <input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15.00" />
        </Field>
        {!item && (
          <Field label="How many are in the fridge now?">
            <input className={inputCls} inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
          </Field>
        )}
        <Field label="Warn when down to" hint="Shows “Low” at this many or fewer. 0 = only warn when it runs out.">
          <input className={inputCls} inputMode="numeric" value={lowAt} onChange={(e) => setLowAt(e.target.value)} />
        </Field>
        {item && (
          <label className="flex items-center gap-2 text-navy-800">
            <input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Still stocked (untick to hide it; its history stays)
          </label>
        )}
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StockDialog({ mode, item, onClose }: { mode: 'restock' | 'count'; item: Item; onClose: () => void }) {
  const { update } = useCtx();
  const [n, setN] = useState(mode === 'count' ? String(Math.max(0, item.stock)) : '');
  const [note, setNote] = useState('');
  const { error, run } = useFormError();
  const num = Number(n);
  const change = mode === 'count' && n !== '' && Number.isInteger(num) ? num - item.stock : 0;

  const save = () =>
    run(() => {
      const now = new Date();
      if (n.trim() === '' || !Number.isFinite(num)) throw new Error('Type a number.');
      if (mode === 'restock') update((d) => recordRestock(d, { itemId: item.id, qty: num, now, note }));
      else update((d) => recordCount(d, { itemId: item.id, counted: num, now, note }));
    }) && onClose();

  return (
    <Modal title={mode === 'restock' ? `Restock ${item.name}` : `Count ${item.name}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-navy-700">
          The records say <b>{item.stock}</b> in the fridge.
        </p>
        <Field label={mode === 'restock' ? 'How many did you put in?' : 'How many are really there?'}>
          <input className={inputCls} autoFocus inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
        {mode === 'count' && change !== 0 && (
          <p className="text-sm font-bold text-amber-800">
            {change < 0 ? `${-change} missing` : `${change} more than recorded`} — this will be noted in the history.
          </p>
        )}
        <Field label="Note (optional)">
          <input
            className={inputCls}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === 'restock' ? 'e.g. bought at Woermann Brock' : 'e.g. monthly count'}
          />
        </Field>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
