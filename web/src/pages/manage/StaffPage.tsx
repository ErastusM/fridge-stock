import { FormEvent, useState } from 'react';
import { get, patch, post } from '../../lib/api';
import type { Role, StaffMember } from '../../lib/types';
import { Button, Card, cx, ErrorNote, Field, inputCls, Modal, Spinner, useLoad, useToast } from '../../components/ui';
import { scopeQuery, useManage } from './context';

type Draft = { id?: string; name: string; role: Role; restaurantId: string | null; email: string; pin: string; password: string; active: boolean };

const ROLE_LABEL: Record<Role, string> = { STAFF: 'Kitchen / bar staff', MANAGER: 'Manager', OWNER: 'Owner (all venues)' };

export default function StaffPage() {
  const { user, restaurants, restaurantId } = useManage();
  const toast = useToast();
  const staff = useLoad(() => get<StaffMember[]>(`/staff${scopeQuery(restaurantId)}`), [restaurantId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const venue = (id: string | null) => (id ? restaurants.find((r) => r.id === id)?.name ?? '' : 'All venues');
  const roles: Role[] = user.role === 'OWNER' ? ['STAFF', 'MANAGER', 'OWNER'] : ['STAFF', 'MANAGER'];

  const open = (s?: StaffMember) =>
    setDraft(
      s
        ? { id: s.id, name: s.name, role: s.role, restaurantId: s.restaurantId, email: s.email ?? '', pin: '', password: '', active: s.active }
        : { name: '', role: 'STAFF', restaurantId: restaurantId || user.restaurantId || restaurants[0]?.id || null, email: '', pin: '', password: '', active: true },
    );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    const signIn = draft.role !== 'STAFF';
    try {
      if (draft.id) {
        await patch(`/staff/${draft.id}`, {
          name: draft.name,
          role: draft.role,
          active: draft.active,
          ...(draft.pin ? { pin: draft.pin } : {}),
          ...(signIn ? { email: draft.email || null } : {}),
          ...(signIn && draft.password ? { password: draft.password } : {}),
        });
      } else {
        await post('/staff', {
          name: draft.name,
          role: draft.role,
          restaurantId: draft.role === 'OWNER' ? null : draft.restaurantId,
          pin: draft.pin,
          ...(signIn ? { email: draft.email, password: draft.password } : {}),
        });
      }
      toast(draft.id ? 'Saved' : `${draft.name} added`);
      setDraft(null);
      await staff.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Staff</h1>
        <Button onClick={() => open()}>Add person</Button>
      </div>
      <p className="text-navy-600">Everyone gets a 4–6 digit PIN for the fridge tablets, so each take is recorded against a name. Managers and owners also sign in here with email and password.</p>
      {staff.loading && !staff.data ? (
        <Spinner />
      ) : (
        <Card className="divide-y divide-navy-100 p-0">
          {(staff.data ?? []).map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <p className={cx('font-semibold', !s.active && 'text-navy-400 line-through')}>{s.name}</p>
                <p className="text-sm text-navy-500">
                  {ROLE_LABEL[s.role]} · {venue(s.restaurantId)}
                  {s.email && ` · ${s.email}`}
                </p>
              </div>
              {!s.active && <span className="rounded-full bg-navy-100 px-2 py-0.5 text-xs font-bold text-navy-600">INACTIVE</span>}
              {(user.role === 'OWNER' || s.role !== 'OWNER') && (
                <Button size="sm" variant="secondary" onClick={() => open(s)}>
                  Edit
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit person' : 'Add person'}>
        {draft && (
          <form className="space-y-4" onSubmit={save}>
            <Field label="Name">
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} required maxLength={80} />
            </Field>
            <Field label="Role">
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })} className={inputCls} disabled={draft.id === user.id}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            {!draft.id && draft.role !== 'OWNER' && user.role === 'OWNER' && (
              <Field label="Venue">
                <select value={draft.restaurantId ?? ''} onChange={(e) => setDraft({ ...draft, restaurantId: e.target.value })} className={inputCls}>
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={draft.id ? 'New PIN (leave blank to keep)' : 'PIN'} hint="4–6 digits. Must differ from everyone else who uses the same tablets.">
              <input
                value={draft.pin}
                onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                inputMode="numeric"
                autoComplete="off"
                className={inputCls}
                required={!draft.id}
                minLength={4}
              />
            </Field>
            {draft.role !== 'STAFF' && (
              <>
                <Field label="Email (for signing in)">
                  <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputCls} required />
                </Field>
                <Field label={draft.id ? 'New password (leave blank to keep)' : 'Password'} hint="At least 10 characters.">
                  <input type="password" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} className={inputCls} minLength={10} />
                </Field>
              </>
            )}
            {draft.id && draft.id !== user.id && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                Active (untick when someone leaves — their PIN stops working, their history stays)
              </label>
            )}
            <ErrorNote error={error} />
            <Button type="submit">Save</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
