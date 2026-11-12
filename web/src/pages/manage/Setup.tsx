import { FormEvent, useState } from 'react';
import { get, patch, post } from '../../lib/api';
import type { Fridge, Item } from '../../lib/types';
import { Button, Card, Empty, ErrorNote, Field, inputCls, Modal, Spinner, useLoad, useToast } from '../../components/ui';
import { KIND_LABEL, UNIT_LABEL, UNITS, Unit } from '../../lib/format';
import { scopeQuery, useManage } from './context';

/** Restaurants (owners), fridges and the item catalogue. */
export default function Setup() {
  const { user, restaurants, restaurantId, reloadRestaurants } = useManage();
  const toast = useToast();
  const fridges = useLoad(() => get<Fridge[]>(`/fridges${scopeQuery(restaurantId)}`), [restaurantId]);
  const items = useLoad(() => get<Item[]>(`/items${scopeQuery(restaurantId)}`), [restaurantId]);
  const [editFridge, setEditFridge] = useState<Partial<Fridge> | null>(null);
  const [editItem, setEditItem] = useState<Partial<Item> | null>(null);
  const [newRestaurant, setNewRestaurant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultRestaurant = restaurantId || (user.role !== 'OWNER' ? user.restaurantId ?? '' : restaurants[0]?.id ?? '');
  const nameOf = (id: string) => restaurants.find((r) => r.id === id)?.name ?? '';

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await fn();
      toast(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-black">Fridges &amp; items</h1>

      {user.role === 'OWNER' && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">Restaurants</h2>
            <Button size="sm" onClick={() => setNewRestaurant('')}>
              Add restaurant
            </Button>
          </div>
          <Card className="divide-y divide-navy-100 p-0">
            {restaurants.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <span className="font-semibold">{r.name}</span>
                <span className="text-sm text-navy-500">{r.timezone}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">Fridges</h2>
          <Button size="sm" onClick={() => setEditFridge({ restaurantId: defaultRestaurant, kind: 'REACH_IN', name: '' })}>
            Add fridge
          </Button>
        </div>
        {fridges.loading && !fridges.data ? (
          <Spinner />
        ) : fridges.data?.length === 0 ? (
          <Empty>No fridges yet.</Empty>
        ) : (
          <Card className="divide-y divide-navy-100 p-0">
            {fridges.data!.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex-1">
                  <p className={`font-semibold ${f.active ? '' : 'text-navy-400 line-through'}`}>{f.name}</p>
                  <p className="text-sm text-navy-500">
                    {!restaurantId && `${f.restaurantName} · `}
                    {KIND_LABEL[f.kind]} · {f.itemCount} items · {f.deviceCount} tablet{f.deviceCount === 1 ? '' : 's'}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditFridge(f)}>
                  Edit
                </Button>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">Items</h2>
          <Button size="sm" onClick={() => setEditItem({ restaurantId: defaultRestaurant, name: '', category: 'General', unit: 'EACH', defaultShelfLifeDays: 3 })}>
            Add item
          </Button>
        </div>
        {items.loading && !items.data ? (
          <Spinner />
        ) : items.data?.length === 0 ? (
          <Empty>No items yet.</Empty>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="bg-navy-50 text-navy-600">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2">Unit</th>
                  <th className="px-4 py-2">Shelf life</th>
                  {!restaurantId && <th className="px-4 py-2">Restaurant</th>}
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {items.data!.map((i) => (
                  <tr key={i.id} className={i.active ? '' : 'text-navy-400'}>
                    <td className="px-4 py-2 font-semibold">{i.name}</td>
                    <td className="px-4 py-2">{i.category}</td>
                    <td className="px-4 py-2">{UNIT_LABEL[i.unit as Unit]}</td>
                    <td className="px-4 py-2">{i.defaultShelfLifeDays} days</td>
                    {!restaurantId && <td className="px-4 py-2 text-navy-500">{nameOf(i.restaurantId)}</td>}
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditItem(i)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <Modal open={newRestaurant !== null} onClose={() => setNewRestaurant(null)} title="Add restaurant">
        <form
          className="space-y-4"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (await run(() => post('/restaurants', { name: newRestaurant, timezone: 'Africa/Windhoek' }), 'Restaurant added')) {
              setNewRestaurant(null);
              await reloadRestaurants();
            }
          }}
        >
          <Field label="Name">
            <input value={newRestaurant ?? ''} onChange={(e) => setNewRestaurant(e.target.value)} className={inputCls} required maxLength={80} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit">Add</Button>
        </form>
      </Modal>

      <Modal open={!!editFridge} onClose={() => setEditFridge(null)} title={editFridge?.id ? 'Edit fridge' : 'Add fridge'}>
        {editFridge && (
          <form
            className="space-y-4"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              const ok = editFridge.id
                ? await run(() => patch(`/fridges/${editFridge.id}`, { name: editFridge.name, kind: editFridge.kind, active: editFridge.active }), 'Fridge saved')
                : await run(() => post('/fridges', { restaurantId: editFridge.restaurantId, name: editFridge.name, kind: editFridge.kind }), 'Fridge added');
              if (ok) {
                setEditFridge(null);
                await fridges.reload();
              }
            }}
          >
            {!editFridge.id && user.role === 'OWNER' && (
              <Field label="Restaurant">
                <select value={editFridge.restaurantId} onChange={(e) => setEditFridge({ ...editFridge, restaurantId: e.target.value })} className={inputCls}>
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Name">
              <input value={editFridge.name ?? ''} onChange={(e) => setEditFridge({ ...editFridge, name: e.target.value })} className={inputCls} required maxLength={80} placeholder="e.g. Walk-in cooler" />
            </Field>
            <Field label="Type">
              <select value={editFridge.kind} onChange={(e) => setEditFridge({ ...editFridge, kind: e.target.value })} className={inputCls}>
                {Object.entries(KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            {editFridge.id && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={editFridge.active} onChange={(e) => setEditFridge({ ...editFridge, active: e.target.checked })} />
                In use (unticking hides it from tablets and lists; history is kept)
              </label>
            )}
            <ErrorNote error={error} />
            <Button type="submit">Save</Button>
          </form>
        )}
      </Modal>

      <Modal open={!!editItem} onClose={() => setEditItem(null)} title={editItem?.id ? 'Edit item' : 'Add item'}>
        {editItem && (
          <form
            className="space-y-4"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              const body = { name: editItem.name, category: editItem.category, unit: editItem.unit, defaultShelfLifeDays: Number(editItem.defaultShelfLifeDays) };
              const ok = editItem.id
                ? await run(() => patch(`/items/${editItem.id}`, { ...body, active: editItem.active }), 'Item saved')
                : await run(() => post('/items', { ...body, restaurantId: editItem.restaurantId }), 'Item added — now stock it in a fridge under Stock');
              if (ok) {
                setEditItem(null);
                await items.reload();
              }
            }}
          >
            {!editItem.id && user.role === 'OWNER' && (
              <Field label="Restaurant">
                <select value={editItem.restaurantId} onChange={(e) => setEditItem({ ...editItem, restaurantId: e.target.value })} className={inputCls}>
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Name">
              <input value={editItem.name ?? ''} onChange={(e) => setEditItem({ ...editItem, name: e.target.value })} className={inputCls} required maxLength={80} />
            </Field>
            <Field label="Category" hint="Groups items into tabs on the tablet (e.g. Seafood, Dairy, Drinks).">
              <input value={editItem.category ?? ''} onChange={(e) => setEditItem({ ...editItem, category: e.target.value })} className={inputCls} required maxLength={40} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit">
                <select value={editItem.unit} onChange={(e) => setEditItem({ ...editItem, unit: e.target.value })} className={inputCls}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABEL[u]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Shelf life (days)" hint="Default use-by when put in.">
                <input type="number" min={0} max={3650} value={editItem.defaultShelfLifeDays ?? 3} onChange={(e) => setEditItem({ ...editItem, defaultShelfLifeDays: Number(e.target.value) })} className={inputCls} />
              </Field>
            </div>
            {editItem.id && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={editItem.active} onChange={(e) => setEditItem({ ...editItem, active: e.target.checked })} />
                Active
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
