import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { get, post, tokens } from '../../lib/api';
import type { Restaurant, User } from '../../lib/types';
import { Button, cx, ErrorNote, Field, inputCls, Spinner } from '../../components/ui';
import { Ctx } from './context';
import { DemoSignIn, IS_DEMO } from '../../demo/DemoBits';
import Dashboard from './Dashboard';
import StockPage from './StockPage';
import StockCount from './StockCount';
import History from './History';
import Reports from './Reports';
import Setup from './Setup';
import StaffPage from './StaffPage';
import Tablets from './Tablets';
import Accounts from './Accounts';
import Statements from './Statements';
import Receive from './Receive';

const NAV = [
  { to: '', label: 'Dashboard' },
  { to: 'stock', label: 'Stock' },
  { to: 'receive', label: 'Receive & record' },
  { to: 'count', label: 'Stock count' },
  { to: 'accounts', label: 'Staff accounts' },
  { to: 'statements', label: 'Statements' },
  { to: 'history', label: 'History' },
  { to: 'reports', label: 'Reports' },
  { to: 'setup', label: 'Fridges & items' },
  { to: 'staff', label: 'Staff' },
  { to: 'tablets', label: 'Tablets' },
];

export default function ManageApp() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantIdState] = useState<string>(() => {
    try {
      return localStorage.getItem('fs.restaurant') ?? '';
    } catch {
      return '';
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);

  const setRestaurantId = (id: string) => {
    setRestaurantIdState(id);
    try {
      localStorage.setItem('fs.restaurant', id);
    } catch {
      /* ignore */
    }
  };

  const reloadRestaurants = useCallback(async () => {
    const rs = await get<Restaurant[]>('/restaurants');
    setRestaurants(rs);
  }, []);

  const loadMe = useCallback(async () => {
    if (!tokens.user()) {
      setChecked(true);
      return;
    }
    try {
      const me = await get<User>('/auth/me');
      setUser(me);
      await reloadRestaurants();
    } catch {
      setUser(null);
    } finally {
      setChecked(true);
    }
  }, [reloadRestaurants]);

  useEffect(() => {
    void loadMe();
    const out = () => setUser(null);
    window.addEventListener('fs:signed-out', out);
    return () => window.removeEventListener('fs:signed-out', out);
  }, [loadMe]);

  // A manager is pinned to their restaurant; an owner's stale choice falls back to "all".
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'OWNER' && user.restaurantId && restaurantId !== user.restaurantId) setRestaurantId(user.restaurantId);
    if (user.role === 'OWNER' && restaurantId && restaurants.length && !restaurants.some((r) => r.id === restaurantId)) setRestaurantId('');
  }, [user, restaurants, restaurantId]);

  const signOut = () => {
    tokens.setUser(null);
    setUser(null);
  };

  if (!checked) return <Spinner />;
  if (!user) return <Login onIn={loadMe} />;

  return (
    <Ctx.Provider value={{ user, restaurants, restaurantId, setRestaurantId, reloadRestaurants, signOut }}>
      <div className="min-h-full">
        <header className="no-print sticky top-0 z-30 border-b-4 border-beacon-500 bg-navy-800 text-white shadow">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <button className="rounded-lg p-2 lg:hidden" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
              ☰
            </button>
            <Link to="/manage" className="text-lg font-black tracking-tight">
              Fridge Stock
            </Link>
            <div className="ml-auto flex items-center gap-3">
              {user.role === 'OWNER' ? (
                <select value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} className="max-w-[12rem] rounded-lg bg-navy-700 px-2 py-1.5 text-sm text-white" aria-label="Restaurant">
                  <option value="">All restaurants</option>
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="hidden text-sm text-navy-100 sm:inline">{user.restaurantName}</span>
              )}
              <span className="hidden text-sm sm:inline">{user.name}</span>
              <button onClick={signOut} className="rounded-lg bg-navy-700 px-3 py-1.5 text-sm">
                Sign out
              </button>
            </div>
          </div>
        </header>
        <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
          <nav className={cx('no-print w-48 shrink-0 space-y-1 lg:block', menuOpen ? 'fixed inset-y-0 left-0 z-40 block w-64 bg-white p-4 pt-20 shadow-xl' : 'hidden')}>
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to ? `/manage/${n.to}` : '/manage'}
                end
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => cx('block rounded-xl px-3 py-2 font-medium', isActive ? 'bg-navy-800 text-white' : 'text-navy-700 hover:bg-navy-50')}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <main className="min-w-0 flex-1">
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="stock" element={<StockPage />} />
              <Route path="count" element={<StockCount />} />
              <Route path="receive" element={<Receive />} />
              <Route path="accounts" element={<Accounts />} />
              <Route path="statements" element={<Statements />} />
              <Route path="history" element={<History />} />
              <Route path="reports" element={<Reports />} />
              <Route path="setup" element={<Setup />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="tablets" element={<Tablets />} />
              <Route path="*" element={<Navigate to="/manage" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

function Login({ onIn }: { onIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ token: string }>('/auth/login', { email, password }, 'none');
      tokens.setUser(r.token);
      await onIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-full items-center justify-center bg-sand-100 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-3xl border-t-4 border-beacon-500 bg-white p-8 shadow-xl">
        <div>
          <h1 className="text-2xl font-black text-navy-900">Manager sign in</h1>
          <p className="text-sm text-navy-500">Fridge Stock · The Lighthouse Group</p>
        </div>
        {IS_DEMO && (
          <DemoSignIn
            onToken={async (t) => {
              tokens.setUser(t);
              await onIn();
            }}
          />
        )}
        <Field label="Email">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} required />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} required />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <Link to="/" className="block text-center text-sm text-navy-500 underline">
          Back
        </Link>
      </form>
    </div>
  );
}
