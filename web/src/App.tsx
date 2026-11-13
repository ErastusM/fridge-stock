import { useCallback, useEffect, useRef, useState } from 'react';
import { FridgeTab } from './FridgeTab';
import { PeopleTab } from './PeopleTab';
import { RecordTab } from './RecordTab';
import { ReportTab } from './ReportTab';
import { backupNow, SettingsTab } from './SettingsTab';
import { useFridge } from './store';
import { FridgeCtx } from './ui';

const TABS = [
  { id: 'record', label: 'Take', icon: '🥤' },
  { id: 'fridge', label: 'Stock', icon: '🧊' },
  { id: 'people', label: 'People', icon: '👥' },
  { id: 'report', label: 'Report', icon: '📄' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const tabFromHash = (): TabId => {
  const h = location.hash.replace('#', '');
  return (TABS.find((t) => t.id === h)?.id ?? 'record') as TabId;
};

interface Toast {
  id: number;
  msg: string;
  undo?: () => void;
}

export default function App() {
  const { data, update, saveFailed } = useFridge();
  const [tab, setTabState] = useState<TabId>(tabFromHash);
  const [toastState, setToast] = useState<Toast | null>(null);
  const timer = useRef<number>(undefined);

  const setTab = useCallback((t: TabId) => {
    setTabState(t);
    history.replaceState(null, '', `#${t}`);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const f = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  const toast = useCallback((msg: string, undo?: () => void) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), msg, undo });
    timer.current = window.setTimeout(() => setToast(null), undo ? 8000 : 3500);
  }, []);

  const last = data.settings.lastBackupAt ? new Date(data.settings.lastBackupAt).getTime() : 0;
  const needsBackup = data.entries.length > 0 && Date.now() - last > 31 * 86_400_000;

  return (
    <FridgeCtx.Provider value={{ data, update, toast }}>
      <div className="min-h-full bg-white">
        <header className="no-print sticky top-0 z-30 border-b-4 border-beacon-500 bg-navy-800 text-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <Logo />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/70">Lighthouse Group</div>
              <h1 className="truncate text-lg font-black leading-tight">{data.settings.fridgeName}</h1>
            </div>
            <nav className="hidden gap-1 sm:flex" aria-label="Sections">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === t.id ? 'bg-white text-navy-900' : 'text-white/85 hover:bg-white/10'}`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {saveFailed && (
          <div role="alert" className="no-print bg-beacon-500 px-4 py-2 text-center font-bold text-white">
            This device could not save the last change. Download a backup in Settings now.
          </div>
        )}
        {needsBackup && !saveFailed && tab !== 'settings' && (
          <div className="no-print border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
            {last ? 'No backup for over a month.' : 'No backup yet.'}{' '}
            <button type="button" className="font-bold underline" onClick={() => backupNow(data, update)}>
              Download one now
            </button>
          </div>
        )}

        <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 sm:pb-10">
          {tab === 'record' && <RecordTab goTo={setTab} />}
          {tab === 'fridge' && <FridgeTab />}
          {tab === 'people' && <PeopleTab openReport={() => setTab('report')} />}
          {tab === 'report' && <ReportTab />}
          {tab === 'settings' && <SettingsTab />}
        </main>

        <nav
          className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-navy-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
          aria-label="Sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-bold ${tab === t.id ? 'text-beacon-600' : 'text-navy-600'}`}
            >
              <span className="text-xl leading-none" aria-hidden>
                {t.icon}
              </span>
              {t.label}
            </button>
          ))}
        </nav>

        {toastState && (
          <div
            key={toastState.id}
            role="status"
            className="no-print fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-navy-900 px-4 py-3 text-white shadow-xl sm:bottom-6"
          >
            <span className="min-w-0 flex-1 font-bold">{toastState.msg}</span>
            {toastState.undo && (
              <button
                type="button"
                className="rounded-lg px-2 py-1 font-black text-beacon-500 hover:bg-white/10"
                onClick={() => {
                  toastState.undo?.();
                  setToast(null);
                  toast('Undone');
                }}
              >
                UNDO
              </button>
            )}
          </div>
        )}
      </div>
    </FridgeCtx.Provider>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#ffffff" />
      <path d="M13 8h6l1.5 17h-9z" fill="#54595f" />
      <path d="M12.2 13h7.6M11.8 18h8.4" stroke="#fff" strokeWidth="1.6" />
      <path d="M14 8l2-3 2 3" fill="#dd3333" />
      <path d="M20 9l7-3M20 11l7 1" stroke="#dd3333" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
