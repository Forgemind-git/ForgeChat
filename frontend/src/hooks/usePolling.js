import { useState, useEffect, useRef, useCallback } from 'react';

// `deps` (optional): values the fetch closes over. When any change, the data is
// refetched immediately instead of waiting for the next poll tick. Pass a stable-length
// array per call-site. Defaults to [] = poll-only (original behaviour).
export function usePolling(fetchFn, intervalMs = 15000, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  const refetch = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const d = await fetchRef.current();
        if (mounted) {
          setData(d);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      mounted = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refreshKey, ...deps]);

  return { data, loading, error, refetch };
}
