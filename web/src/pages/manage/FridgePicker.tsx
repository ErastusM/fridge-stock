import { useEffect } from 'react';
import type { Fridge } from '../../lib/types';
import { inputCls } from '../../components/ui';
import { useManage } from './context';

/** Choose one fridge; groups by restaurant when an owner is looking at all of them. */
export function FridgePicker({ fridges, value, onChange, allowAll }: { fridges: Fridge[]; value: string; onChange: (id: string) => void; allowAll?: boolean }) {
  const { restaurantId } = useManage();
  const active = fridges.filter((f) => f.active);
  useEffect(() => {
    if (!allowAll && !value && active[0]) onChange(active[0].id);
    if (value && !fridges.some((f) => f.id === value)) onChange(allowAll ? '' : active[0]?.id ?? '');
  }, [fridges, value, allowAll, active, onChange]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls + ' max-w-xs'} aria-label="Fridge">
      {allowAll && <option value="">All fridges</option>}
      {active.map((f) => (
        <option key={f.id} value={f.id}>
          {!restaurantId ? `${f.restaurantName} · ` : ''}
          {f.name}
        </option>
      ))}
    </select>
  );
}
