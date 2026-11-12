import { useEffect, useState } from 'react';
import { inputCls } from '../../components/ui';
import { useManage } from './context';

/**
 * Money is kept per venue. Uses the header's choice when one is made; when an owner is looking
 * at "all restaurants" the page asks for one venue.
 */
export function useVenue(): [string, (id: string) => void] {
  const { restaurantId, restaurants, user } = useManage();
  const [local, setLocal] = useState(restaurantId || user.restaurantId || restaurants[0]?.id || '');
  useEffect(() => {
    if (restaurantId) setLocal(restaurantId);
    else if (!local && restaurants[0]) setLocal(restaurants[0].id);
  }, [restaurantId, restaurants, local]);
  return [restaurantId || local, setLocal];
}

export function VenuePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { restaurantId, restaurants, user } = useManage();
  if (restaurantId || user.role !== 'OWNER' || restaurants.length < 2) return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls + ' max-w-xs'} aria-label="Venue">
      {restaurants.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}
