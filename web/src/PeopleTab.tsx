import { useState } from 'react';
import { addPerson, formatMoney, monthReport, periodKeyOf, updatePerson, type Person } from './model';
import { Button, Empty, ErrorLine, Field, inputCls, Modal, useCtx, useFormError } from './ui';

export function PeopleTab({ openReport }: { openReport: () => void }) {
  const { data } = useCtx();
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const key = periodKeyOf(new Date(), data.settings.monthStartDay);
  const report = monthReport(data, key);
  const sums = new Map(report.people.map((p) => [p.personId, p]));
  const people = [...data.people].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-navy-900">People</h2>
          <p className="text-sm text-navy-600">Everyone who takes from the fridge. Totals are for this month.</p>
        </div>
        <Button kind="primary" onClick={() => setEditing('new')}>
          + Add person
        </Button>
      </div>
      {people.length === 0 ? (
        <Empty>No one yet. Add the employees by name.</Empty>
      ) : (
        <ul className="divide-y divide-navy-100 rounded-2xl border border-navy-200 bg-white">
          {people.map((p) => {
            const s = sums.get(p.id);
            return (
              <li key={p.id} className={`flex items-center gap-3 px-3 py-3 ${p.active ? '' : 'opacity-60'}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-800 font-black text-white">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-navy-900">
                    {p.name}
                    {!p.active && <span className="ml-2 text-xs font-normal">(no longer here)</span>}
                  </div>
                  <div className="text-sm text-navy-600">
                    {s ? `${s.qty} item${s.qty === 1 ? '' : 's'} · ${formatMoney(s.amountCents)}` : 'Nothing this month'}
                  </div>
                </div>
                <Button kind="ghost" onClick={() => setEditing(p)}>
                  Edit
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {report.people.length > 0 && (
        <Button onClick={openReport}>See the monthly report</Button>
      )}
      {editing && <PersonDialog person={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PersonDialog({ person, onClose }: { person?: Person; onClose: () => void }) {
  const { update } = useCtx();
  const [name, setName] = useState(person?.name ?? '');
  const [active, setActive] = useState(person?.active ?? true);
  const { error, run } = useFormError();
  const save = () =>
    run(() => update((d) => (person ? updatePerson(d, person.id, { name, active }) : addPerson(d, name)))) && onClose();
  return (
    <Modal title={person ? `Edit ${person.name}` : 'Add a person'} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" hint="As it should appear on the monthly report.">
          <input className={inputCls} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {person && (
          <label className="flex items-center gap-2 text-navy-800">
            <input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Still works here (untick to hide them; their history stays)
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
