import { BrowserRouter, HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/ui';
import { DemoNote } from './demo/DemoBits';
import KioskApp from './pages/kiosk/KioskApp';
import ManageApp from './pages/manage/ManageApp';
import { tokens } from './lib/api';

function Home() {
  // A paired tablet goes straight to its fridge.
  if (tokens.device() && import.meta.env.VITE_DEMO !== '1') return <Navigate to="/kiosk" replace />;
  return (
    <div className="flex min-h-full flex-col bg-white">
      <div className="h-1.5 bg-beacon-500" />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg text-center">
          <img src="icon.svg" alt="" className="mx-auto mb-5 h-20 w-20" />
          <p className="text-sm font-bold uppercase tracking-[0.25em] text-beacon-500">The Lighthouse Group</p>
          <h1 className="mt-2 text-4xl font-light text-navy-800">
            Fridge <span className="font-black">Stock</span>
          </h1>
          <p className="mt-2 text-navy-600">Swakopmund</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <Link to="/kiosk" className="rounded-3xl bg-navy-800 p-6 text-left text-white shadow-md hover:bg-navy-700">
              <p className="text-xl font-black">Fridge tablet</p>
              <p className="mt-1 text-sm text-navy-100">Take, put in, throw away — with your PIN</p>
            </Link>
            <Link to="/manage" className="rounded-3xl bg-white p-6 text-left text-navy-900 shadow-md ring-1 ring-navy-200 hover:ring-beacon-500">
              <p className="text-xl font-black">Manage</p>
              <p className="mt-1 text-sm text-navy-600">Stock, staff accounts and statements</p>
            </Link>
          </div>
          {import.meta.env.VITE_DEMO === '1' && <DemoNote />}
        </div>
      </div>
    </div>
  );
}

// A static host (GitHub Pages) cannot send every path to index.html, so the demo routes by hash.
const Router = import.meta.env.VITE_DEMO === '1' ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/kiosk" element={<KioskApp />} />
          <Route path="/manage/*" element={<ManageApp />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </ToastProvider>
  );
}
