import { format, parseISO } from 'date-fns';
import { stationLabel } from '../lib/station';
import type { CurrentTideLevel, Station } from '../types';

interface Props {
  current: CurrentTideLevel | undefined;
  station: Station | null;
  isLoading: boolean;
  /**
   * `full` is the standalone card; `compact` is the strip that rides in the header next to the
   * title on wide screens, where there is only room for the reading itself.
   */
  variant?: 'full' | 'compact';
}

const TREND_ROTATION: Record<CurrentTideLevel['trend'], number> = {
  Rising: -45,
  Falling: 45,
  Steady: 0,
};

function TrendArrow({ trend, size = 18 }: { trend: CurrentTideLevel['trend']; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: `rotate(${TREND_ROTATION[trend]}deg)` }}
      aria-hidden="true"
    >
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="14 6 20 12 14 18" />
    </svg>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2" title="Live gauge reading">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-300 opacity-75"></span>
      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-300"></span>
    </span>
  );
}

function CompactTile({ current, station, isLoading }: Omit<Props, 'variant'>) {
  if (isLoading && !current) {
    return <div className="h-14 w-52 rounded-lg bg-gray-800 animate-pulse" aria-hidden="true"></div>;
  }

  if (!current) return null;

  const timeStr = format(parseISO(current.timestamp), 'h:mm a');

  return (
    <div className="rounded-lg bg-gradient-to-br from-teal-600 to-cyan-800 px-4 py-2 text-white shadow-md shadow-cyan-900/30">
      <div className="flex items-center gap-2.5">
        <span className="text-2xl font-semibold tabular-nums leading-none">{current.value.toFixed(2)}m</span>
        <span className="flex items-center gap-1 text-base text-cyan-100">
          <TrendArrow trend={current.trend} size={16} />
          {current.trend}
        </span>
        {current.source === 'Observed' && <LiveDot />}
      </div>
      <div
        className="mt-1 max-w-[18rem] truncate text-sm text-cyan-200/80"
        title={current.source === 'Predicted' ? 'Predicted - no live gauge at this station' : undefined}
      >
        {station ? `${stationLabel(station)} - ` : ''}
        {timeStr}
        {current.source === 'Predicted' && ' (predicted)'}
      </div>
    </div>
  );
}

export default function CurrentTideTile({ current, station, isLoading, variant = 'full' }: Props) {
  if (variant === 'compact') {
    return <CompactTile current={current} station={station} isLoading={isLoading} />;
  }

  if (isLoading && !current) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 animate-pulse">
        <div className="h-4 bg-gray-700 rounded w-40 mb-4"></div>
        <div className="h-10 bg-gray-700 rounded w-32 mb-2"></div>
        <div className="h-4 bg-gray-700 rounded w-48"></div>
      </div>
    );
  }

  if (!current) return null;

  const ts = parseISO(current.timestamp);
  const timeStr = format(ts, 'h:mm a');

  return (
    <div className="bg-gradient-to-br from-teal-600 to-cyan-800 text-white rounded-xl p-6 shadow-lg shadow-cyan-900/30">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-medium text-cyan-200 uppercase tracking-wide">
          Current tide level
          {station && (
            // Station names carry their own capitalisation and punctuation, so they're
            // left in their normal case rather than swept up by the heading's uppercase.
            <span className="normal-case"> - {stationLabel(station)}</span>
          )}
        </h2>
        {current.source === 'Observed' && <LiveDot />}
      </div>
      <div className="text-4xl font-semibold mb-2">{current.value.toFixed(2)}m</div>
      <div className="text-cyan-100 text-lg flex items-center gap-1.5">
        <TrendArrow trend={current.trend} />
        <span>{current.trend}</span>
      </div>
      <div className="mt-2 text-cyan-200/80 text-sm">
        As of {timeStr}
        {current.source === 'Predicted' && ' · predicted (no live gauge at this station)'}
      </div>
    </div>
  );
}
