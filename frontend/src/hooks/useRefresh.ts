/**
 * useRefresh — Shared pull-to-refresh hook
 *
 * Wraps a data loader in a refreshing state flag suitable for
 * passing directly to ScrollView/FlatList RefreshControl.
 *
 * Usage:
 *   const { refreshing, onRefresh } = useRefresh(loadData);
 *   <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
 */
import { useState, useCallback } from 'react';

export function useRefresh(loader: () => Promise<void> | void) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loader();
    } catch { /* loader handles its own errors */ }
    finally { setRefreshing(false); }
  }, [loader]);

  return { refreshing, onRefresh };
}
