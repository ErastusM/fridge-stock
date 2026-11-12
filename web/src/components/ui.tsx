import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ExpiryStatus, StockStatus } from '../lib/types';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-navy-800 text-white hover:bg-navy-700 disabled:bg-navy-200',
  secondary: 'bg-white text-navy-800 ring-1 ring-navy-200 hover:bg-navy-50 disabled:text-navy-200',
  danger: 'bg-beacon-500 text-white hover:bg-beacon-600 disabled:opacity-40',
  ghost: 'text-navy-700 hover:bg-navy-50',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2.5',
        size === 'lg' && 'px-6 py-4 text-lg',
        VARIANT[variant],
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-navy-100', className)}>{children}</div>;
}

const STOCK_BADGE: Record<StockStatus, string> = {
  OK: 'bg-emerald-100 text-emerald-800',
  LOW: 'bg-amber-100 text-amber-900',
  OUT: 'bg-beacon-500 text-white',
};
const EXPIRY_BADGE: Record<ExpiryStatus, string> = {
  FRESH: 'bg-emerald-100 text-emerald-800',
  EXPIRING: 'bg-orange-100 text-orange-900',
  EXPIRED: 'bg-red-700 text-white',
};

export function StockBadge({ status }: { status: StockStatus }) {
  if (status === 'OK') return null;
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold tracking-wide', STOCK_BADGE[status])}>{status === 'LOW' ? 'LOW' : 'OUT'}</span>;
}

export function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  if (status === 'FRESH') return null;
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold tracking-wide', EXPIRY_BADGE[status])}>{status === 'EXPIRING' ? 'USE SOON' : 'EXPIRED'}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-navy-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-navy-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-xl border-0 bg-white px-3 py-2 ring-1 ring-navy-200 focus:outline-none focus:ring-2 focus:ring-navy-500';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-navy-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold text-navy-900">{title}</h2>
          <button onClick={onClose} className="-m-2 rounded-full p-2 text-2xl leading-none text-navy-500 hover:bg-navy-50" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800 ring-1 ring-red-200">{error}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-navy-50 px-4 py-6 text-center text-navy-500">{children}</p>;
}

export function Spinner() {
  return <div className="mx-auto my-8 h-8 w-8 animate-spin rounded-full border-4 border-navy-100 border-t-navy-700" />;
}

// ---------- toasts ----------
type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++n.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'rounded-2xl px-5 py-3 text-base font-semibold shadow-lg',
              t.tone === 'ok' && 'bg-emerald-700 text-white',
              t.tone === 'error' && 'bg-red-700 text-white',
              t.tone === 'info' && 'bg-navy-800 text-white',
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Load data with loading/error state and a reload function. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}
