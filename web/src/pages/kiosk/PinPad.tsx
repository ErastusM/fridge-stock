import { useEffect, useState } from 'react';
import { cx } from '../../components/ui';

/** 4–6 digit PIN entry with big keys. Physical keyboards work too. */
export function PinPad({ onSubmit, busy, error, label = 'Enter your PIN' }: { onSubmit: (pin: string) => void; busy?: boolean; error?: string | null; label?: string }) {
  const [pin, setPin] = useState('');
  const send = () => {
    if (pin.length < 4 || busy) return;
    onSubmit(pin);
    setPin('');
  };
  const press = (k: string) => {
    if (busy) return;
    if (k === 'back') setPin((p) => p.slice(0, -1));
    else if (k === 'clear') setPin('');
    else setPin((p) => (p.length < 6 ? p + k : p));
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') send();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  return (
    <div className="kiosk mx-auto max-w-xs">
      <p className="mb-3 text-center text-lg font-semibold text-navy-800">{label}</p>
      <div className="mb-4 flex justify-center gap-3" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span key={i} className={cx('h-4 w-4 rounded-full', i < pin.length ? 'bg-navy-800' : 'bg-navy-100')} />
        ))}
      </div>
      {error && <p className="mb-3 text-center font-semibold text-red-700">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className={cx(
              'h-16 rounded-2xl text-2xl font-bold active:scale-95',
              k === 'clear' || k === 'back' ? 'bg-navy-50 text-base text-navy-700' : 'bg-white text-navy-900 ring-1 ring-navy-200',
            )}
            aria-label={k === 'back' ? 'Delete' : k === 'clear' ? 'Clear' : k}
          >
            {k === 'back' ? '⌫' : k === 'clear' ? 'Clear' : k}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={pin.length < 4 || busy}
        onClick={send}
        className="mt-4 h-16 w-full rounded-2xl bg-navy-800 text-xl font-bold text-white disabled:bg-navy-200"
      >
        {busy ? 'Saving…' : 'Confirm'}
      </button>
    </div>
  );
}
