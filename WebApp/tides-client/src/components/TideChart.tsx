import { useMemo, useRef, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip as ChartTooltip,
  TimeScale,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import 'chartjs-adapter-date-fns';
import { Line } from 'react-chartjs-2';
import { parseISO, format } from 'date-fns';
import type { ChartOptions } from 'chart.js';
import type { TidePredictionResponse, LowestTideAnalysis } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, ChartTooltip, TimeScale, zoomPlugin);

interface Props {
  predictions: TidePredictionResponse | undefined;
  analysis: LowestTideAnalysis | undefined;
  isLoading: boolean;
  onShiftDays: (days: number) => void;
}

// Color stops for 12AM → 12PM (mirrored for PM → AM)
//  0h = #6b21a8 (purple)
//  3h = #1e3a8a (deep blue)
//  6h = #0ea5e9 (sky blue)
//  9h = #eab308 (yellow)
// 12h = #f59e0b (amber)
interface ColorStop { pos: number; r: number; g: number; b: number }

const COLOR_STOPS: ColorStop[] = [
  { pos: 0.0,  r: 107, g:  33, b: 168 }, // #6b21a8
  { pos: 0.25, r:  30, g:  58, b: 138 }, // #1e3a8a
  { pos: 0.5,  r:  14, g: 165, b: 233 }, // #0ea5e9
  { pos: 0.75, r: 234, g: 179, b:   8 }, // #eab308
  { pos: 1.0,  r: 245, g: 158, b:  11 }, // #f59e0b
];

function timeOfDayColor(hour: number): string {
  // Mirror: 0→12 and 12→24 use the same curve
  const t = 1 - Math.abs((hour % 24) - 12) / 12;

  // Find the two stops we sit between
  let lo = COLOR_STOPS[0];
  let hi = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (t >= COLOR_STOPS[i].pos && t <= COLOR_STOPS[i + 1].pos) {
      lo = COLOR_STOPS[i];
      hi = COLOR_STOPS[i + 1];
      break;
    }
  }

  const range = hi.pos - lo.pos;
  const frac = range === 0 ? 0 : (t - lo.pos) / range;
  const r = Math.round(lo.r + (hi.r - lo.r) * frac);
  const g = Math.round(lo.g + (hi.g - lo.g) * frac);
  const b = Math.round(lo.b + (hi.b - lo.b) * frac);
  return `rgb(${r},${g},${b})`;
}

export default function TideChart({ predictions, analysis, isLoading, onShiftDays }: Props) {
  const chartRef = useRef<ChartJS<'line'>>(null);

  const chartPoints = useMemo(() => {
    if (!predictions) return [];
    return predictions.dataPoints.map((dp) => ({
      x: parseISO(dp.timestamp).getTime(),
      y: dp.value,
    }));
  }, [predictions]);

  const segmentColors = useMemo(() => {
    if (!predictions) return [];
    return predictions.dataPoints.map((dp) => {
      const d = parseISO(dp.timestamp);
      const hour = d.getHours() + d.getMinutes() / 60;
      return timeOfDayColor(hour);
    });
  }, [predictions]);

  const lowestIdx = useMemo(() => {
    if (!analysis || !predictions) return -1;
    return predictions.dataPoints.findIndex((dp) => dp.value === analysis.lowestTide.value);
  }, [analysis, predictions]);

  const pointRadii = useMemo(() => {
    if (!predictions) return [];
    return predictions.dataPoints.map((_, i) => (i === lowestIdx ? 6 : 0));
  }, [predictions, lowestIdx]);

  const pointColors = useMemo(() => {
    if (!predictions) return [];
    return predictions.dataPoints.map((_, i) => (i === lowestIdx ? '#ef4444' : 'transparent'));
  }, [predictions, lowestIdx]);

  const handleResetZoom = useCallback(() => {
    chartRef.current?.resetZoom();
  }, []);

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="h-6 bg-gray-700 rounded w-40 mb-4 animate-pulse"></div>
        <div className="h-64 bg-gray-700/50 rounded animate-pulse"></div>
      </div>
    );
  }

  if (!predictions || chartPoints.length === 0) return null;

  const data = {
    datasets: [
      {
        data: chartPoints,
        borderWidth: 2,
        pointRadius: pointRadii,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors.map((c) => (c === '#ef4444' ? '#1f2937' : 'transparent')),
        pointBorderWidth: pointRadii.map((r) => (r > 0 ? 2 : 0)),
        pointHoverRadius: 4,
        pointHoverBackgroundColor: '#9ca3af',
        tension: 0.3,
        fill: false,
        segment: {
          borderColor: (ctx: { p0DataIndex: number }) => segmentColors[ctx.p0DataIndex] ?? '#9ca3af',
        },
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: 'day',
          displayFormats: { day: 'MMM d' },
          tooltipFormat: 'EEE, MMM d, h:mm a',
        },
        grid: { color: 'rgba(255,255,255,0.06)' },
        ticks: { color: '#9ca3af', font: { size: 12 } },
      },
      y: {
        title: {
          display: true,
          text: 'Water Level (m)',
          color: '#9ca3af',
          font: { size: 12 },
        },
        grid: { color: 'rgba(255,255,255,0.06)' },
        ticks: { color: '#9ca3af', font: { size: 12 } },
      },
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => `Tide Level: ${(ctx.parsed.y ?? 0).toFixed(2)}m`,
        },
        backgroundColor: '#1f2937',
        titleColor: '#f3f4f6',
        bodyColor: '#d1d5db',
        borderColor: '#374151',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10,
      },
      legend: { display: false },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x' as const,
        },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: 'x' as const,
        },
      },
    },
  };

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 sm:p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">
            Tide Levels &mdash; {predictions.station.officialName}
          </h2>
          {analysis && (() => {
            const ts = parseISO(analysis.lowestTide.timestamp);
            return (
              <p className="text-sm text-gray-400 mt-0.5">
                Lowest: <span className="text-red-400 font-semibold">{analysis.lowestTide.value.toFixed(2)}m</span>
                {' '}&mdash; {format(ts, 'EEE, MMM d')} at {format(ts, 'h:mm a')}
                <span className="text-gray-500 ml-1">({analysis.timeOfDay})</span>
              </p>
            );
          })()}
        </div>
        <div className="hidden sm:flex flex-col items-end gap-1.5 shrink-0">
          <button
            onClick={handleResetZoom}
            className="px-3 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
          >
            Reset Zoom
          </button>
          <div className="flex gap-1.5">
            <button onClick={() => onShiftDays(-30)} className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors">&laquo; 30d</button>
            <button onClick={() => onShiftDays(-7)} className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors">&lsaquo; 7d</button>
            <button onClick={() => onShiftDays(7)} className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors">7d &rsaquo;</button>
            <button onClick={() => onShiftDays(30)} className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors">30d &raquo;</button>
          </div>
        </div>
      </div>
      <div className="w-full h-[320px] touch-none">
        <Line ref={chartRef} data={data} options={options} />
      </div>
      <div className="flex sm:hidden items-center justify-center gap-1.5 mt-3">
          <button onClick={() => onShiftDays(-30)} className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors">&laquo; 30d</button>
          <button onClick={() => onShiftDays(-7)} className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors">&lsaquo; 7d</button>
          <button
            onClick={handleResetZoom}
            className="px-3 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
          >
            Reset Zoom
          </button>
          <button onClick={() => onShiftDays(7)} className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors">7d &rsaquo;</button>
          <button onClick={() => onShiftDays(30)} className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors">30d &raquo;</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: timeOfDayColor(0) }}></span>
          Midnight
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: timeOfDayColor(6) }}></span>
          Morning
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: timeOfDayColor(12) }}></span>
          Noon
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: timeOfDayColor(18) }}></span>
          Evening
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-red-500 rounded-full"></span>
          Lowest tide
        </div>
      </div>
    </div>
  );
}
