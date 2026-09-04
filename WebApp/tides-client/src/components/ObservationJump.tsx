import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { format, parseISO } from 'date-fns';
import { getObservation } from '../api/tidesApi';
import { useAllStations } from '../hooks/useStations';
import { nearestStation } from '../lib/geo';
import { observationJumpTarget } from '../lib/observation';
import { stationLabel } from '../lib/station';
import type { Observation, Station } from '../types';

interface Props {
  selectedStation: Station | null;
  onSelectStation: (station: Station) => void;
  /** Sends the sighting's date and time to the chart's jump-to, as `yyyy-MM-dd` and `HH:mm`. */
  onJump: (date: string, time: string) => void;
  /** Steps out of the way so the chart underneath can be seen, once a sighting has landed on it. */
  onViewOnChart: () => void;
}

type Status =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'resolved'; observation: Observation };

// How far from a station a sighting can be before the current selection is worth questioning.
// Tide stations are sparse, so a sighting is routinely tens of kilometres from the nearest one.
const SUGGEST_SWITCH_KM = 25;

/**
 * Looks up an iNaturalist observation and points the chart at the tide when it was recorded.
 *
 * Takes the observation URL rather than a pasted timestamp on purpose. What iNaturalist shows on
 * the page is a localized display string, and the raw `observed_on_string` behind it is
 * free-form - two observations posted minutes apart can carry different shapes. The URL is the
 * one thing that is trivially copyable and unambiguous, and it resolves to the coordinates as
 * well as the time, which is what makes the station suggestion possible.
 */
export default function ObservationJump({ selectedStation, onSelectStation, onJump, onViewOnChart }: Props) {
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  const resolved = status.state === 'resolved' ? status.observation : null;
  const hasCoordinates = resolved?.latitude != null && resolved?.longitude != null;

  // The full station list is a much larger payload than a search, so it is only pulled once a
  // sighting with coordinates actually needs it.
  const { data: stations, isError: stationsFailed } = useAllStations(hasCoordinates);

  const nearest =
    resolved && hasCoordinates && stations
      ? nearestStation(stations, resolved.latitude!, resolved.longitude!)
      : null;

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = reference.trim();
    if (!trimmed) return;

    setStatus({ state: 'loading' });
    try {
      const observation = await getObservation(trimmed);
      setStatus({ state: 'resolved', observation });

      const { date, time } = observationJumpTarget(observation);
      onJump(date, time);
    } catch (error) {
      setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Failed to look up that observation',
      });
    }
  }, [reference, onJump]);

  const handleClear = useCallback(() => {
    setReference('');
    setStatus({ state: 'idle' });
  }, []);

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="url"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="https://www.inaturalist.org/observations/…"
          aria-label="iNaturalist observation link or id"
          className="flex-1 min-w-0 px-3 py-1.5 text-sm text-gray-200 bg-gray-700 border border-gray-600 rounded-md placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-400"
        />
        <button
          type="submit"
          disabled={!reference.trim() || status.state === 'loading'}
          className="px-3 py-1.5 text-sm font-medium text-gray-200 bg-gray-700 border border-gray-600 rounded-md transition-colors hover:bg-gray-600 disabled:opacity-50 disabled:hover:bg-gray-700"
        >
          {status.state === 'loading' ? 'Looking up…' : 'Find'}
        </button>
        {(resolved || status.state === 'error') && (
          <button
            type="button"
            onClick={handleClear}
            className="px-2.5 py-1.5 text-sm font-medium text-gray-400 bg-gray-700 rounded-md transition-colors hover:bg-gray-600"
          >
            Clear
          </button>
        )}
      </form>

      {status.state === 'error' && (
        <p className="mt-3 text-sm text-red-400">{status.message}</p>
      )}

      {resolved && (
        <div className="mt-3 text-sm text-gray-300 space-y-1">
          <p>
            <span className="text-gray-500">Observed</span>{' '}
            <span className="font-medium text-gray-100">
              {format(parseISO(resolved.observedLocal), 'EEE, MMM d, yyyy')} at{' '}
              {format(parseISO(resolved.observedLocal), 'h:mm a')}
            </span>
            {resolved.timeZone && <span className="text-gray-500"> ({resolved.timeZone})</span>}
          </p>

          {resolved.placeGuess && <p className="text-gray-400">{resolved.placeGuess}</p>}

          {!hasCoordinates && (
            <p className="text-gray-500">
              This observation's location is hidden, so there's no station to suggest.
            </p>
          )}

          {/* Both of these leave the sighting resolved and the current station untouched - the
              suggestion is the only part that can't be made, and saying so beats silence. */}
          {hasCoordinates && stationsFailed && (
            <p className="text-gray-500">
              The station list couldn't be loaded, so there's no station to suggest. The time above
              has still been sent to the chart.
            </p>
          )}

          {hasCoordinates && stations && !nearest && (
            <p className="text-gray-500">
              No tide station could be matched to this sighting, so the chart is still showing
              whichever station you had picked.
            </p>
          )}

          {nearest && nearest.station.code !== selectedStation?.code && (
            <p className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-gray-400">
                Nearest station: {stationLabel(nearest.station)} ({Math.round(nearest.distanceKm)} km away)
              </span>
              <button
                type="button"
                onClick={() => onSelectStation(nearest.station)}
                className="px-2.5 py-1 text-xs font-medium text-cyan-300 bg-cyan-900/40 border border-cyan-700/70 rounded-md transition-colors hover:bg-cyan-900/70"
              >
                Switch to it
              </button>
            </p>
          )}

          {/* Far from any station is worth saying plainly - the coverage is Canada plus the US
              west coast, and a sighting outside that still resolves perfectly well. */}
          {nearest && nearest.distanceKm > SUGGEST_SWITCH_KM && nearest.station.code === selectedStation?.code && (
            <p className="text-gray-500">
              The nearest station is {Math.round(nearest.distanceKm)} km away, so the tide here is
              only a rough guide.
            </p>
          )}

          <p className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onViewOnChart}
              className="px-2.5 py-1 text-xs font-medium text-gray-200 bg-gray-700 rounded-md transition-colors hover:bg-gray-600"
            >
              Show it on the chart
            </button>
            <a
              href={resolved.uri}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-gray-500 underline hover:text-gray-300"
            >
              View on iNaturalist
            </a>
          </p>
        </div>
      )}
    </>
  );
}
