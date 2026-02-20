import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import type { LowestTideAnalysis } from '../types';

interface Props {
  analysis: LowestTideAnalysis | undefined;
  isLoading: boolean;
}

export default function LowestTidesTable({ analysis, isLoading }: Props) {
  const topTides = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.dailyLows]
      .sort((a, b) => a.lowestValue - b.lowestValue)
      .slice(0, 10)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [analysis]);

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 sm:p-6 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-48 mb-4"></div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-700/50 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!analysis || topTides.length === 0) return null;

  const overallLowest = analysis.lowestTide.value;

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-100 mb-3">Top 10 Lowest Tides</h2>
      <div className="overflow-x-auto">
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
                  className={`border-b border-gray-700/50 ${isOverallLowest ? 'text-red-400' : 'text-gray-300'}`}
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
