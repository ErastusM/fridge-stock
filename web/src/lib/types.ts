export type StockStatus = 'OK' | 'LOW' | 'OUT';
export type ExpiryStatus = 'FRESH' | 'EXPIRING' | 'EXPIRED';
export type Role = 'STAFF' | 'MANAGER' | 'OWNER';

export interface BatchView {
  id: string;
  qty: number;
  expiresAt: string;
  receivedAt: string;
  expiry: ExpiryStatus;
}

export interface StockLine {
  fridgeId: string;
  fridgeName: string;
  restaurantId: string;
  restaurantName: string;
  itemId: string;
  name: string;
  category: string;
  unit: string;
  defaultShelfLifeDays: number;
  qty: number;
  minQty: number;
  parLevel: number;
  status: StockStatus;
  reorderQty: number;
  expiry: ExpiryStatus;
  nextExpiry: string | null;
  batches: BatchView[];
}

export interface KioskData {
  device: { id: string; name: string };
  fridge: { id: string; name: string };
  restaurant: { id: string; name: string; timezone: string };
  expiringHours: number;
  items: StockLine[];
  otherFridges: { id: string; name: string }[];
  serverTime: string;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  restaurantId: string | null;
  restaurantName: string | null;
}

export interface Restaurant {
  id: string;
  name: string;
  timezone: string;
  active: boolean;
}

export interface Fridge {
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  kind: string;
  active: boolean;
  itemCount: number;
  deviceCount: number;
}

export interface Item {
  id: string;
  restaurantId: string;
  name: string;
  category: string;
  unit: string;
  defaultShelfLifeDays: number;
  active: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
  role: Role;
  restaurantId: string | null;
  email: string | null;
  active: boolean;
  canSignIn: boolean;
}

export interface Device {
  id: string;
  name: string;
  fridgeId: string;
  fridgeName: string;
  restaurantName: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Movement {
  id: string;
  type: string;
  qty: number;
  qtyAfter: number;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  fridge: { name: string; restaurant: { name: string; timezone: string } };
  item: { name: string; unit: string; category: string };
  staff: { name: string };
  device: { name: string } | null;
}

export interface Dashboard {
  summary: { id: string; name: string; fridges: number; items: number; low: number; out: number; expiring: number; expired: number }[];
  reorder: StockLine[];
  expiring: (BatchView & { fridgeId: string; fridgeName: string; restaurantName: string; itemId: string; name: string; unit: string })[];
  last24h: Record<string, number>;
}

export interface Usage {
  from: string;
  to: string;
  timezone: string;
  daily: { date: string; itemId: string; name: string; category: string; unit: string; taken: number; wasted: number; added: number }[];
  totals: { itemId: string; name: string; category: string; unit: string; taken: number; wasted: number; added: number }[];
  wasteReasons: { reason: string; count: number }[];
}
