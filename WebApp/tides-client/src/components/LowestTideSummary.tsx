import { format, parseISO } from 'date-fns';
import type { LowestTideAnalysis } from '../types';

interface Props {
  analysis: LowestTideAnalysis | undefined;
  isLoading: boolean;
}

export default function LowestTideSummary({ analysis, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-48 mb-3"></div>
        <div className="h-10 bg-gray-700 rounded w-64 mb-2"></div>
        <div className="h-5 bg-gray-700 rounded w-56"></div>
      </div>
    );
  }

  if (!analysis) return null;

  const ts = parseISO(analysis.lowestTide.timestamp);
  const dateStr = format(ts, 'EEEE, MMMM d');
  const timeStr = format(ts, 'h:mm a');

  return (
    <div className="bg-gradient-to-br from-blue-600 to-indigo-800 text-white rounded-xl p-6 shadow-lg shadow-blue-900/30">
      <h2 className="text-sm font-medium text-blue-300 uppercase tracking-wide mb-1">Lowest Tide</h2>
      <div className="text-4xl font-bold mb-2">{analysis.lowestTide.value.toFixed(2)}m</div>
      <div className="text-blue-100 text-lg">
        {dateStr} at {timeStr}
      </div>
      <div className="mt-2 inline-block bg-white/15 text-blue-100 text-sm font-medium px-3 py-1 rounded-full">
        {analysis.timeOfDay}
      </div>
    </div>
  );
}
