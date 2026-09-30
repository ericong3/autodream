import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { generateId } from '../utils/format';

// Calls onActivity whenever a new activity-history entry is recorded for
// this work order ('all' = any work order) — every step (installer or
// salesman, on any device) writes one, so this is the signal to refresh.
export function useWorkOrderActivityUpdates(workOrderId: string | 'all' | undefined, onActivity: () => void) {
  const callback = useRef(onActivity);
  callback.current = onActivity;

  useEffect(() => {
    if (!workOrderId) return;
    const channel = supabase
      .channel(`garage-wo-activity-${workOrderId}-${generateId()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT', schema: 'public', table: 'garage_work_order_activity',
          ...(workOrderId === 'all' ? {} : { filter: `work_order_id=eq.${workOrderId}` }),
        },
        () => callback.current(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workOrderId]);
}
