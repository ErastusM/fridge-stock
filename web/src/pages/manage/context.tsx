import { createContext, useContext } from 'react';
import type { Restaurant, User } from '../../lib/types';

export interface ManageCtx {
  user: User;
  restaurants: Restaurant[];
  /** '' = all restaurants (owners only). */
  restaurantId: string;
  setRestaurantId: (id: string) => void;
  reloadRestaurants: () => Promise<void>;
  signOut: () => void;
}

export const Ctx = createContext<ManageCtx | null>(null);
export function useManage(): ManageCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('outside manage app');
  return c;
}

/** `?restaurantId=…` for the API, or '' for every restaurant in scope. */
export function scopeQuery(restaurantId: string, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams();
  if (restaurantId) p.set('restaurantId', restaurantId);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The zone used for dates: the selected restaurant's, else the first one's. */
export function useTz() {
  const { restaurants, restaurantId } = useManage();
  return (restaurants.find((r) => r.id === restaurantId) ?? restaurants[0])?.timezone ?? 'Africa/Windhoek';
}
