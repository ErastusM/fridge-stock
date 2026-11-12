const USER_KEY = 'fs.userToken';
const DEVICE_KEY = 'fs.deviceToken';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* storage blocked: the session just won't persist */
  }
}

export const tokens = {
  user: () => read(USER_KEY),
  setUser: (t: string | null) => write(USER_KEY, t),
  device: () => read(DEVICE_KEY),
  setDevice: (t: string | null) => write(DEVICE_KEY, t),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** No response at all — the tablet is offline or the server is down. */
  get offline() {
    return this.status === 0;
  }
}

type Auth = 'user' | 'device' | 'none';

const DEMO = import.meta.env.VITE_DEMO === '1';
// Loaded only in demo builds, so the real app never ships the stand-in server.
const demo = DEMO ? import('../demo/demoServer') : null;

async function demoCall(method: string, url: string, body: unknown, auth: Auth) {
  const m = await demo!;
  try {
    return await m.demoFetch({ method, url, body, userToken: auth === 'user' ? tokens.user() : null, deviceToken: auth === 'device' ? tokens.device() : null });
  } catch (e) {
    if (e instanceof m.DemoHttpError) {
      if (e.status === 401 && auth === 'user') {
        tokens.setUser(null);
        window.dispatchEvent(new Event('fs:signed-out'));
      }
      throw new ApiError(e.status, e.message, e.details);
    }
    throw e;
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown, auth: Auth = 'user'): Promise<T> {
  if (DEMO) return (await demoCall(method, url, body, auth)).data as T;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const t = auth === 'user' ? tokens.user() : auth === 'device' ? tokens.device() : null;
  if (t && auth === 'user') headers.authorization = `Bearer ${t}`;
  if (t && auth === 'device') headers['x-device-token'] = t;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'No connection to the server');
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const body = data && typeof data === 'object' ? (data as { error?: unknown }) : null;
    const msg = body?.error ? String(body.error) : res.statusText;
    if (res.status === 401 && auth === 'user') {
      tokens.setUser(null);
      window.dispatchEvent(new Event('fs:signed-out'));
    }
    throw new ApiError(res.status, msg, (data as { details?: unknown } | null)?.details);
  }
  return data as T;
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/** Download a CSV through the authenticated API (a plain link could not carry the token). */
export async function downloadCsv(url: string, fallbackName: string) {
  if (DEMO) {
    const r = await demoCall('GET', url, undefined, 'user');
    return saveBlob(new Blob(['\uFEFF' + (r.csv ?? '')], { type: 'text/csv' }), r.filename ?? fallbackName);
  }
  const res = await fetch(`/api${url}`, { headers: { authorization: `Bearer ${tokens.user() ?? ''}` } });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  saveBlob(blob, name);
}

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const get = <T>(url: string, auth: Auth = 'user') => api<T>('GET', url, undefined, auth);
export const post = <T>(url: string, body: unknown, auth: Auth = 'user') => api<T>('POST', url, body, auth);
export const put = <T>(url: string, body: unknown) => api<T>('PUT', url, body);
export const patch = <T>(url: string, body: unknown) => api<T>('PATCH', url, body);
export const del = <T>(url: string) => api<T>('DELETE', url);
