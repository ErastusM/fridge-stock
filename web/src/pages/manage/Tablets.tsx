import { FormEvent, useState } from 'react';
import { del, get, post } from '../../lib/api';
import type { Device, Fridge } from '../../lib/types';
import { Button, Card, Empty, ErrorNote, Field, inputCls, Modal, Spinner, useLoad, useToast } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { scopeQuery, useManage, useTz } from './context';
import { FridgePicker } from './FridgePicker';

export default function Tablets() {
  const { restaurantId } = useManage();
  const tz = useTz();
  const toast = useToast();
  const devices = useLoad(() => get<Device[]>(`/devices${scopeQuery(restaurantId)}`), [restaurantId]);
  const fridges = useLoad(() => get<Fridge[]>(`/fridges${scopeQuery(restaurantId)}`), [restaurantId]);
  const [pairing, setPairing] = useState(false);
  const [fridgeId, setFridgeId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [code, setCode] = useState<{ code: string; expiresAt: string; fridgeName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const makeCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setCode(await post(`/fridges/${fridgeId}/pairing-codes`, { deviceName }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const revoke = async (d: Device) => {
    setError(null);
    try {
      await del(`/devices/${d.id}`);
      toast(`${d.name} unpaired`);
      await devices.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const live = (devices.data ?? []).filter((d) => !d.revokedAt);
  const online = (d: Device) => d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 3 * 60_000;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">Tablets</h1>
        <Button
          onClick={() => {
            setPairing(true);
            setCode(null);
            setDeviceName('');
          }}
        >
          Pair a tablet
        </Button>
      </div>
      <p className="text-navy-600">
        Each fridge has its own tablet. On the tablet, open this site and choose <b>Fridge tablet</b>, then type the 6-digit code made here. Unpair a lost or replaced tablet straight away.
      </p>
      <ErrorNote error={error} />
      {devices.loading && !devices.data ? (
        <Spinner />
      ) : live.length === 0 ? (
        <Empty>No tablets paired yet.</Empty>
      ) : (
        <Card className="divide-y divide-navy-100 p-0">
          {live.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className={`h-3 w-3 rounded-full ${online(d) ? 'bg-emerald-500' : 'bg-navy-200'}`} title={online(d) ? 'Online' : 'Not seen recently'} />
              <div className="flex-1">
                <p className="font-semibold">{d.name}</p>
                <p className="text-sm text-navy-500">
                  {!restaurantId && `${d.restaurantName} · `}
                  {d.fridgeName} · {d.lastSeenAt ? `last seen ${fmtDateTime(d.lastSeenAt, tz)}` : 'never connected'}
                </p>
              </div>
              <Button size="sm" variant="danger" onClick={() => revoke(d)}>
                Unpair
              </Button>
            </div>
          ))}
        </Card>
      )}

      <Modal open={pairing} onClose={() => setPairing(false)} title="Pair a tablet">
        {code ? (
          <div className="text-center">
            <p className="text-navy-600">Type this on the tablet for {code.fridgeName}:</p>
            <p className="my-4 text-5xl font-black tracking-[0.3em] text-navy-900">{code.code}</p>
            <p className="text-sm text-navy-500">Works once, until {fmtDateTime(code.expiresAt, tz)}.</p>
            <Button
              className="mt-4"
              onClick={() => {
                setPairing(false);
                void devices.reload();
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={makeCode}>
            <Field label="Fridge">
              <FridgePicker fridges={fridges.data ?? []} value={fridgeId} onChange={setFridgeId} />
            </Field>
            <Field label="Tablet name">
              <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className={inputCls} placeholder="e.g. Walk-in door tablet" required maxLength={80} />
            </Field>
            <ErrorNote error={error} />
            <Button type="submit" disabled={!fridgeId}>
              Create code
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
