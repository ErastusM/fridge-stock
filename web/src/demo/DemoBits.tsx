import { useState } from 'react';
import { DEMO_PEOPLE, demoFridges, demoPairFridge, demoSignInToken, resetDemo } from './demoServer';

export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

/** Home-page note: what the demo is, the cast, and a reset. */
export function DemoNote() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-8 rounded-2xl bg-sand-100 p-4 text-left text-sm text-navy-700 ring-1 ring-navy-100">
      <p>
        <b className="text-beacon-600">Demo.</b> Everything runs on this device with sample data — nothing is sent anywhere, and other phones have their own copy.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => setOpen((o) => !o)} className="rounded-xl bg-white px-3 py-1.5 font-semibold ring-1 ring-navy-200">
          {open ? 'Hide' : 'Show'} demo PINs
        </button>
        <button
          onClick={() => {
            resetDemo();
            window.location.reload();
          }}
          className="rounded-xl bg-white px-3 py-1.5 font-semibold text-beacon-600 ring-1 ring-navy-200"
        >
          Reset demo data
        </button>
      </div>
      {open && <PinTable />}
    </div>
  );
}

export function PinTable() {
  const venues = ['Venue A', 'Venue B', 'Head Office'];
  return (
    <table className="mt-3 w-full text-left text-sm">
      <thead className="text-navy-500">
        <tr>
          <th className="py-1">Person</th>
          <th className="py-1">Where</th>
          <th className="py-1 text-right">PIN</th>
        </tr>
      </thead>
      <tbody>
        {DEMO_PEOPLE.map((p) => (
          <tr key={p.name} className="border-t border-navy-100">
            <td className="py-1 font-semibold">{p.name}</td>
            <td className="py-1">{p.venue === null ? 'All venues (owner)' : venues[p.venue]}</td>
            <td className="py-1 text-right font-mono font-bold">{p.pin}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Login page: one tap per demo account (the demo has no real passwords). */
export function DemoSignIn({ onToken }: { onToken: (t: string) => void }) {
  const accounts = DEMO_PEOPLE.filter((p) => p.email);
  return (
    <div className="space-y-2 rounded-2xl bg-sand-100 p-3">
      <p className="text-sm font-semibold text-navy-700">Demo — sign in as:</p>
      <div className="grid gap-2">
        {accounts.map((a) => (
          <button key={a.email} type="button" onClick={() => onToken(demoSignInToken(a.email!))} className="rounded-xl bg-white px-3 py-2 text-left text-sm font-semibold ring-1 ring-navy-200 hover:ring-beacon-500">
            {a.name} <span className="font-normal text-navy-500">· {a.role === 'OWNER' ? 'sees every venue' : ['Venue A', 'Venue B', 'Head Office'][a.venue!]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tablet setup: pick a fridge instead of typing a code (the code flow works too). */
export function DemoPair({ onToken }: { onToken: (t: string) => void }) {
  const fridges = demoFridges();
  return (
    <div className="mt-6 space-y-2 text-left">
      <p className="text-sm font-semibold text-navy-700">Demo — make this phone the tablet for:</p>
      {fridges.map((f) => (
        <button key={f.id} onClick={() => onToken(demoPairFridge(f.id))} className="block w-full rounded-xl bg-sand-100 px-4 py-3 text-left font-semibold ring-1 ring-navy-100 hover:ring-beacon-500">
          {f.name} <span className="font-normal text-navy-500">· {f.restaurantName.replace(' (demo)', '')}</span>
        </button>
      ))}
    </div>
  );
}
