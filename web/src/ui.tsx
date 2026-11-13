import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Data } from './model';

export interface Ctx {
  data: Data;
  update: (change: (d: Data) => Data) => void;
  toast: (msg: string, undo?: () => void) => void;
}
export const FridgeCtx = createContext<Ctx>(null as unknown as Ctx);
export const useCtx = () => useContext(FridgeCtx);

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost';
const BTN: Record<BtnKind, string> = {
  primary: 'bg-beacon-500 text-white hover:bg-beacon-600 disabled:bg-navy-200',
  secondary: 'bg-white text-navy-800 border border-navy-200 hover:bg-navy-50 disabled:text-navy-400',
  danger: 'bg-white text-beacon-600 border border-beacon-500/40 hover:bg-beacon-500/5',
  ghost: 'text-navy-700 hover:bg-navy-100',
};
export function Button({
  kind = 'secondary',
  className = '',
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind }) {
  return (
    <button
      type="button"
      {...p}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-bold transition-colors disabled:cursor-not-allowed ${BTN[kind]} ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-navy-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-navy-600">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full min-h-11 rounded-xl border border-navy-200 bg-white px-3 text-navy-900 outline-none focus:border-navy-800 focus:ring-2 focus:ring-navy-200';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-navy-900/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-navy-900">{title}</h2>
          <button type="button" onClick={onClose} className="-mr-2 rounded-lg p-2 text-navy-600 hover:bg-navy-100" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A small form inside a modal: runs `onSave`, shows the rule's message if it refuses. */
export function useFormError() {
  const [error, setError] = useState('');
  const run = useCallback((fn: () => void) => {
    try {
      setError('');
      fn();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }, []);
  return { error, setError, run };
}

export function ErrorLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-lg bg-beacon-500/10 px-3 py-2 text-sm font-bold text-beacon-600">
      {text}
    </p>
  );
}

export function Badge({ tone, children }: { tone: 'red' | 'amber' | 'grey'; children: ReactNode }) {
  const c = { red: 'bg-beacon-500 text-white', amber: 'bg-amber-100 text-amber-800', grey: 'bg-navy-100 text-navy-700' }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide ${c}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-navy-200 p-6 text-center text-navy-600">{children}</div>;
}

export function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
