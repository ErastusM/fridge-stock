import { useMemo, useState } from 'react';
import { amountOf, fmtDate, fmtTime, formatMoney, recordTake, stockState, voidEntry, type Entry } from './model';
import { Badge, Button, Empty, ErrorLine, Field, inputCls, Modal, useCtx, useFormError } from './ui';

/** "Erastus took two Cokes": choose the person, tap the items, save. */
export function RecordTab({ goTo }: { goTo: (tab: 'people' | 'fridge') => void }) {
  const { data, update, toast } = useCtx();
  const [personId, setPersonId] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [when, setWhen] = useState<string>(''); // '' = now
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const people = data.people.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));
  const items = data.items.filter((i) => i.active).sort((a, b) => a.name.localeCompare(b.name));
  const [who, setWho] = useState('');
  const shownPeople = people.filter((p) => p.name.toLowerCase().includes(who.trim().toLowerCase()));
  const person = data.people.find((p) => p.id === personId);
  const shown = items.filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()));
  const chosen = items.filter((i) => (qty[i.id] ?? 0) > 0);
  const count = chosen.reduce((n, i) => n + qty[i.id], 0);
  const total = chosen.reduce((n, i) => n + (i.priceCents ?? 0) * qty[i.id], 0);

  const reset = () => {
    setPersonId(null);
    setQty({});
    setWhen('');
    setSearch('');
    setWho('');
    setError('');
  };
  const bump = (id: string, by: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(99, (q[id] ?? 0) + by)) }));

  const save = () => {
    if (!person) return;
    try {
      const now = new Date();
      const at = when ? new Date(when) : now;
      let groupId = '';
      update((d) => {
        const r = recordTake(d, { personId: person.id, lines: chosen.map((i) => ({ itemId: i.id, qty: qty[i.id] })), at, now });
        groupId = r.groupId;
        return r.data;
      });
      const what = chosen.map((i) => `${qty[i.id]} × ${i.name}`).join(', ');
      toast(`${person.name} took ${what}`, () =>
        update((d) => {
          const first = d.entries.find((e) => e.groupId === groupId && !e.voided);
          return first ? voidEntry(d, { entryId: first.id, reason: 'Undone straight after saving', now: new Date(), wholeGroup: true }) : d;
        }),
      );
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  if (people.length === 0 || items.length === 0) {
    return (
      <Empty>
        <p className="mb-3 font-bold text-navy-800">Let’s set up the fridge first.</p>
        <p className="mb-4">
          {people.length === 0 ? 'Add the people who take from the fridge' : 'Add what is in the fridge'}, then come back here to record who took
          what.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {people.length === 0 && (
            <Button kind="primary" onClick={() => goTo('people')}>
              Add people
            </Button>
          )}
          {items.length === 0 && (
            <Button kind={people.length === 0 ? 'secondary' : 'primary'} onClick={() => goTo('fridge')}>
              Add items
            </Button>
          )}
        </div>
      </Empty>
    );
  }

  if (!person) {
    return (
      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-xl font-black text-navy-900">Who is taking something?</h2>
          {people.length > 8 && (
            <input
              className={`${inputCls} mb-3`}
              type="search"
              placeholder={`Search ${people.length} people`}
              value={who}
              onChange={(e) => setWho(e.target.value)}
              aria-label="Search people"
            />
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {shownPeople.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersonId(p.id)}
                className="flex min-h-14 items-center gap-2 rounded-xl border border-navy-200 bg-white px-2 py-2 text-left shadow-sm hover:border-navy-800 active:scale-[0.98]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-800 text-sm font-black text-white">
                  {initials(p.name)}
                </span>
                <span className="min-w-0 break-words font-bold leading-tight text-navy-900">{p.name}</span>
              </button>
            ))}
          </div>
          {shownPeople.length === 0 && <p className="mt-2 text-navy-600">No one called “{who.trim()}”.</p>}
        </section>
        <RecentTakes />
      </div>
    );
  }

  return (
    <div className="pb-40">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-xl font-black text-navy-900">
          What did <span className="text-beacon-600">{person.name}</span> take?
        </h2>
        <Button kind="ghost" onClick={reset}>
          Change
        </Button>
      </div>
      {items.length > 8 && (
        <input className={`${inputCls} mb-3`} placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((i) => {
          const q = qty[i.id] ?? 0;
          const st = stockState(i);
          return (
            <div
              key={i.id}
              className={`flex items-center gap-2 rounded-2xl border bg-white p-2 pl-3 ${q > 0 ? 'border-beacon-500 ring-2 ring-beacon-500/20' : 'border-navy-200'}`}
            >
              <button type="button" className="min-w-0 flex-1 py-1 text-left" onClick={() => bump(i.id, 1)}>
                <span className="block font-bold text-navy-900">{i.name}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm text-navy-600">
                  {i.priceCents ? formatMoney(i.priceCents) : 'No charge'}
                  <span>· {i.stock} left</span>
                  {st === 'OUT' && <Badge tone="red">Out</Badge>}
                  {st === 'LOW' && <Badge tone="amber">Low</Badge>}
                </span>
              </button>
              <div className="flex items-center">
                <button
                  type="button"
                  aria-label={`One less ${i.name}`}
                  disabled={q === 0}
                  onClick={() => bump(i.id, -1)}
                  className="h-11 w-11 rounded-xl text-2xl font-bold text-navy-800 hover:bg-navy-100 disabled:text-navy-200"
                >
                  −
                </button>
                <span className="w-8 text-center text-xl font-black tabular-nums" aria-live="polite">
                  {q}
                </span>
                <button
                  type="button"
                  aria-label={`One more ${i.name}`}
                  onClick={() => bump(i.id, 1)}
                  className="h-11 w-11 rounded-xl bg-navy-800 text-2xl font-bold text-white hover:bg-navy-900"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-navy-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:bottom-0">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-black text-navy-900">
              {count === 0 ? 'Tap the items taken' : `${count} item${count === 1 ? '' : 's'} · ${formatMoney(total)}`}
            </div>
            {when === '' ? (
              <div className="mt-1 text-sm text-navy-600">
                When: now ·{' '}
                <button type="button" className="font-bold text-navy-800 underline" onClick={() => setWhen(toLocalInput(new Date()))}>
                  earlier?
                </button>
              </div>
            ) : (
              <label className="mt-1 flex flex-wrap items-center gap-2 text-sm text-navy-600">
                When:
                <input
                  type="datetime-local"
                  className="rounded-lg border border-navy-200 px-2 py-1 text-sm"
                  value={when}
                  max={toLocalInput(new Date())}
                  onChange={(e) => setWhen(e.target.value)}
                  aria-label="When it was taken"
                />
                <button type="button" className="font-bold text-navy-800 underline" onClick={() => setWhen('')}>
                  now
                </button>
              </label>
            )}
          </div>
          <Button kind="primary" className="px-6" disabled={count === 0} onClick={save}>
            Save
          </Button>
        </div>
        {error && (
          <div className="mx-auto mt-2 max-w-5xl">
            <ErrorLine text={error} />
          </div>
        )}
      </div>
    </div>
  );
}

/** "Erastus Matheus" → "EM", "Ricardo" → "R". */
function initials(name: string) {
  const parts = name.split(' ').filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The last takes, newest first, each with Undo. */
export function RecentTakes({ limit = 15 }: { limit?: number }) {
  const { data } = useCtx();
  const [undoing, setUndoing] = useState<Entry | null>(null);
  const recent = useMemo(
    () =>
      data.entries
        .filter((e) => e.kind === 'TAKE')
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    [data.entries, limit],
  );
  const name = (id?: string) => data.people.find((p) => p.id === id)?.name ?? '—';
  const item = (id: string) => data.items.find((i) => i.id === id)?.name ?? 'Removed item';
  const today = fmtDate(new Date());

  return (
    <section>
      <h2 className="mb-2 text-lg font-black text-navy-900">Recently taken</h2>
      {recent.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <ul className="divide-y divide-navy-100 rounded-2xl border border-navy-200 bg-white">
          {recent.map((e) => {
            const at = new Date(e.at);
            return (
              <li key={e.id} className={`flex items-center gap-3 px-3 py-2 ${e.voided ? 'opacity-50' : ''}`}>
                <span className="w-14 shrink-0 text-sm tabular-nums text-navy-600">
                  {fmtDate(at) === today ? fmtTime(at) : fmtDate(at).slice(0, 5)}
                </span>
                <span className={`min-w-0 flex-1 ${e.voided ? 'line-through' : ''}`}>
                  <b>{name(e.personId)}</b> took {e.qty} × {item(e.itemId)}
                  {e.voided && <span className="block text-xs no-underline">Undone: {e.voided.reason}</span>}
                </span>
                <span className="hidden text-sm tabular-nums text-navy-600 sm:inline">{amountOf(e) ? formatMoney(amountOf(e)) : ''}</span>
                {!e.voided && (
                  <Button kind="ghost" className="min-h-9 px-2 text-sm" onClick={() => setUndoing(e)}>
                    Undo
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {undoing && <UndoDialog entry={undoing} who={name(undoing.personId)} what={item(undoing.itemId)} onClose={() => setUndoing(null)} />}
    </section>
  );
}

function UndoDialog({ entry, who, what, onClose }: { entry: Entry; who: string; what: string; onClose: () => void }) {
  const { update } = useCtx();
  const [reason, setReason] = useState('');
  const { error, run } = useFormError();
  return (
    <Modal title="Undo this entry?" onClose={onClose}>
      <p className="mb-4 text-navy-700">
        {who} took {entry.qty} × {what} on {fmtDate(new Date(entry.at))} at {fmtTime(new Date(entry.at))}. It stays in the history, struck
        through, and the stock goes back up.
      </p>
      <div className="space-y-3">
        <Field label="Why?">
          <input className={inputCls} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong person, recorded twice" />
        </Field>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Keep it</Button>
          <Button
            kind="primary"
            onClick={() => run(() => update((d) => voidEntry(d, { entryId: entry.id, reason, now: new Date() }))) && onClose()}
          >
            Undo
          </Button>
        </div>
      </div>
    </Modal>
  );
}
