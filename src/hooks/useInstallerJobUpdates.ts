import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { generateId } from '../utils/format';

// Calls onChange whenever any Garage installer job is created or changes
// (e.g. an installer accepts one) — lets salesman/manager screens refresh
// the moment it happens instead of on the next page open.
export function useInstallerJobUpdates(onChange: () => void) {
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    const channel = supabase
      .channel(`garage-installer-jobs-${generateId()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'garage_installer_jobs' }, () => callback.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);
}
