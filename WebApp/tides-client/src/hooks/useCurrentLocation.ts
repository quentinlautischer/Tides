import { useEffect, useMemo, useState } from 'react';

export type CurrentLocation =
  | { status: 'unsupported' }
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'denied' }
  | { status: 'error'; message: string }
  | { status: 'ready'; latitude: number; longitude: number; accuracy: number };

// City-level accuracy is plenty for spotting nearby tide stations, and skipping the
// high-accuracy fix keeps it fast and off the GPS. The cached position is accepted for
// five minutes so toggling the map off and on doesn't re-locate every time.
const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 5 * 60_000,
};

const isSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

/**
 * The browser's best guess at where the user is. Asking triggers a permission prompt,
 * so `enabled` should only go true off the back of something the user did.
 *
 * Note this needs a secure context: it resolves over HTTPS and on localhost, and is
 * blocked outright on a plain-HTTP origin.
 */
export function useCurrentLocation(enabled: boolean): CurrentLocation {
  const [result, setResult] = useState<CurrentLocation | null>(null);

  useEffect(() => {
    if (!enabled || !isSupported) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setResult({
          status: 'ready',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        if (cancelled) return;
        setResult(
          err.code === err.PERMISSION_DENIED
            ? { status: 'denied' }
            : { status: 'error', message: err.message },
        );
      },
      GEOLOCATION_OPTIONS,
    );

    // The callbacks fire once, so there's nothing to unsubscribe from - this only stops
    // a late response from setting state after the component has gone away.
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Memoised so the identity is stable: callers put this in effect dependencies, and a
  // fresh object every render would re-run them forever.
  return useMemo<CurrentLocation>(() => {
    if (!isSupported) return { status: 'unsupported' };
    if (!enabled) return { status: 'idle' };

    // No callback yet means the request is still outstanding, possibly sitting behind
    // the browser's permission prompt.
    return result ?? { status: 'locating' };
  }, [enabled, result]);
}
