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
  priceCents: number | null;
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
  statementStartDay: number;
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
  priceCents: number | null;
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
  unitPriceCents: number | null;
  amountCents: number | null;
  supplier: string | null;
  createdAt: string;
  recordedBy?: { name: string } | null;
  fridge: { name: string; restaurant: { name: string; timezone: string } };
  item: { name: string; unit: string; category: string };
  staff: { name: string };
  device: { name: string } | null;
}

export interface Dashboard {
  summary: {
    id: string;
    name: string;
    fridges: number;
    items: number;
    low: number;
    out: number;
    expiring: number;
    expired: number;
    stockValueCents: number;
    salesTodayCents: number;
    owedCents: number;
  }[];
  reorder: StockLine[];
  expiring: (BatchView & { fridgeId: string; fridgeName: string; restaurantName: string; itemId: string; name: string; unit: string })[];
  last24h: Record<string, number>;
}

export interface Usage {
  from: string;
  to: string;
  timezone: string;
  daily: { date: string; itemId: string; name: string; category: string; unit: string; taken: number; wasted: number; added: number; salesCents: number }[];
  totals: { itemId: string; name: string; category: string; unit: string; taken: number; wasted: number; added: number; salesCents: number }[];
  salesCents: number;
  wasteReasons: { reason: string; count: number }[];
}

export interface Accounts {
  restaurant: { id: string; name: string; timezone: string; statementStartDay: number };
  currentPeriod: { month: string; from: string; to: string };
  totalOwedCents: number;
  rows: { staffId: string; name: string; role: Role; active: boolean; balanceCents: number; lastChargeOn: string | null; lastPaymentOn: string | null }[];
}

export interface Payment {
  id: string;
  staffId: string;
  amountCents: number;
  method: string;
  paidOn: string;
  reference: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  staff: { name: string };
  recordedBy: { name: string };
}

export interface Statement {
  staff: { id: string; name: string; role: Role; active: boolean };
  openingCents: number;
  purchasesCents: number;
  paidCents: number;
  closingCents: number;
  lines: { date: string; at: string; item: string; unit: string; fridge: string; qty: number; unitPriceCents: number | null; amountCents: number }[];
  payments: { date: string; method: string; reference: string | null; amountCents: number }[];
}

export interface Statements {
  restaurant: { id: string; name: string; timezone: string };
  period: { month: string; from: string; to: string; startDay: number };
  generatedAt: string;
  statements: Statement[];
  totals: { purchasesCents: number; paidCents: number; closingCents: number };
}
