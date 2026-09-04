import { useEffect, useState } from 'react';
import Modal from './Modal';
import StationSelector from './StationSelector';
import StationMap from './StationMap';
import { useAllStations } from '../hooks/useStations';
import { useCurrentLocation } from '../hooks/useCurrentLocation';
import { nearestStation } from '../lib/geo';
import { stationLabel } from '../lib/station';
import type { Station } from '../types';

interface Props {
  open: boolean;
  selectedStation: Station | null;
  onSelect: (station: Station) => void;
  onClose: () => void;
}

// What the "closest to me" button has to say for itself while it can't deliver a station.
function locateStatus(status: string): string | null {
  switch (status) {
    case 'locating': return 'Finding you...';
    case 'denied': return 'Location access is blocked in your browser';
    case 'error': return 'Your location could not be determined';
    case 'unsupported': return 'This browser has no location support';
    default: return null;
  }
}

/**
 * The station picker, kept behind a dialog so the page itself is about the tides.
 *
 * Split from the exported component so every piece of picker state - the map toggle, an
 * outstanding location request - starts fresh each time it's opened rather than carrying
 * over from the last time.
 */
function StationPicker({ selectedStation, onSelect, onClose }: Omit<Props, 'open'>) {
  const [showMap, setShowMap] = useState(false);
  // Geolocation is only asked for once the user presses the button, so the permission
  // prompt follows a deliberate action.
  const [locateRequested, setLocateRequested] = useState(false);
  const location = useCurrentLocation(locateRequested);
  // The map pulls the full list anyway; the nearest-station search needs the same list,
  // so either one showing up is reason enough to fetch it.
  const { data: stations, isLoading: stationsLoading } = useAllStations(showMap || locateRequested);

  function handlePick(station: Station) {
    onSelect(station);
    onClose();
  }

  // Resolving the nearest station is the whole point of the location request, so it runs as
  // soon as both halves - the fix and the station list - have landed.
  useEffect(() => {
    if (!locateRequested || location.status !== 'ready' || !stations) return;
    const nearest = nearestStation(stations, location.latitude, location.longitude);
    setLocateRequested(false);
    if (nearest) handlePick(nearest.station);
    // handlePick closes over props that are stable for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateRequested, location, stations]);

  const locateNote = locateRequested
    ? (locateStatus(location.status) ?? (stationsLoading ? 'Loading stations...' : null))
    : null;

  return (
    <Modal
      title="Change station"
      subtitle={selectedStation ? `Currently ${stationLabel(selectedStation)} (${selectedStation.code})` : 'No station selected'}
      onClose={onClose}
    >
      <StationSelector
        selectedStation={selectedStation}
        onSelect={handlePick}
        showMap={showMap}
        onToggleMap={() => setShowMap((v) => !v)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setLocateRequested(true)}
          disabled={locateRequested}
          className="inline-flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
            <circle cx="12" cy="12" r="3.25" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          Closest station to me
        </button>
        {locateNote && <span className="text-xs text-gray-400">{locateNote}</span>}
      </div>

      {showMap && <StationMap station={selectedStation} onSelect={handlePick} />}
    </Modal>
  );
}

export default function StationPickerDialog({ open, ...rest }: Props) {
  if (!open) return null;
  return <StationPicker {...rest} />;
}
