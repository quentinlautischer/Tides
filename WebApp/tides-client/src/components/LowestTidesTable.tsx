import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import WaveLoader from './WaveLoader';
import { useLoadingMessage } from '../hooks/useLoadingMessage';
import type { LowestTideAnalysis } from '../types';

interface Props {
  analysis: LowestTideAnalysis | undefined;
  isLoading: boolean;
  /** New figures are on their way; the ones below belong to the range that was on screen before. */
  isFetching: boolean;
  /** Sends a low to the chart, which centres it and opens its tooltip. */
  onSelect: (timestamp: string) => void;
}

export default function LowestTidesTable({ analysis, isLoading, isFetching, onSelect }: Props) {
  const loadingMessage = useLoadingMessage(isLoading || isFetching);
  const topTides = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.dailyLows]
      .sort((a, b) => a.lowestValue - b.lowestValue)
      .slice(0, 10)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [analysis]);

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-gray-100">Lowest Tides</h2>
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-gray-700/50 animate-pulse"></div>
          ))}
        </div>
        <span className="mt-4 flex items-center gap-2 text-sm text-gray-300">
          <WaveLoader className="h-4 w-8 text-cyan-300" />
          {loadingMessage}
        </span>
      </div>
    );
  }

  if (!analysis || topTides.length === 0) return null;

  const overallLowest = analysis.lowestTide.value;

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-gray-100">Lowest Tides</h2>
        {isFetching && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <WaveLoader className="h-3.5 w-7 text-cyan-300" />
            {loadingMessage}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-3">Pick a row to find it on the chart</p>
      <div className={`overflow-x-auto transition-opacity ${isFetching ? 'opacity-40' : ''}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left py-2 pr-4 font-medium">#</th>
              <th className="text-left py-2 pr-4 font-medium">Date</th>
              <th className="text-left py-2 pr-4 font-medium">Time</th>
              <th className="text-right py-2 font-medium">Level</th>
            </tr>
          </thead>
          <tbody>
            {topTides.map((tide, i) => {
              const ts = parseISO(tide.lowestTimestamp);
              const isOverallLowest = tide.lowestValue === overallLowest;
              return (
                <tr
                  key={tide.date}
                  onClick={() => onSelect(tide.lowestTimestamp)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(tide.lowestTimestamp);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Show ${format(ts, 'EEE, MMM d')} at ${format(ts, 'h:mm a')} on the chart`}
                  className={`border-b border-gray-700/50 cursor-pointer hover:bg-gray-700/40 focus:outline-none focus:bg-gray-700/40 ${isOverallLowest ? 'text-red-400' : 'text-gray-300'}`}
                >
                  <td className="py-2 pr-4 tabular-nums">{i + 1}</td>
                  <td className="py-2 pr-4">{format(ts, 'EEE, MMM d')}</td>
                  <td className="py-2 pr-4">
                    {format(ts, 'h:mm a')}
                    <span className="text-gray-500 ml-1.5 text-xs">{tide.timeOfDay}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">{tide.lowestValue.toFixed(2)}m</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
