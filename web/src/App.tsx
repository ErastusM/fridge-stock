import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/ui';
import KioskApp from './pages/kiosk/KioskApp';
import ManageApp from './pages/manage/ManageApp';
import { tokens } from './lib/api';

function Home() {
  // A paired tablet goes straight to its fridge.
  if (tokens.device()) return <Navigate to="/kiosk" replace />;
  return (
    <div className="flex min-h-full items-center justify-center bg-navy-800 p-6">
      <div className="w-full max-w-lg text-center text-white">
        <img src="/icon.svg" alt="" className="mx-auto mb-4 h-20 w-20" />
        <h1 className="text-4xl font-black">Fridge Stock</h1>
        <p className="mt-2 text-navy-200">Lighthouse group · Swakopmund</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link to="/kiosk" className="rounded-3xl bg-white p-6 text-navy-900 shadow-lg hover:bg-sand-100">
            <p className="text-xl font-black">Fridge tablet</p>
            <p className="mt-1 text-sm text-navy-600">Set this device up at a fridge</p>
          </Link>
          <Link to="/manage" className="rounded-3xl bg-navy-700 p-6 shadow-lg ring-1 ring-navy-500 hover:bg-navy-500">
            <p className="text-xl font-black">Manage</p>
            <p className="mt-1 text-sm text-navy-100">Managers and owners sign in</p>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/kiosk" element={<KioskApp />} />
          <Route path="/manage/*" element={<ManageApp />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
