import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip as ChartTooltip,
  TimeScale,
  Interaction,
} from 'chart.js';
import { getRelativePosition } from 'chart.js/helpers';
import zoomPlugin from 'chartjs-plugin-zoom';
import 'chartjs-adapter-date-fns';
import { Line } from 'react-chartjs-2';
import { parseISO, format } from 'date-fns';
import type { ChartOptions, ChartEvent, InteractionModeFunction, Plugin } from 'chart.js';
import type { TidePredictionResponse, LowestTideAnalysis } from '../types';

declare module 'chart.js' {
  interface InteractionModeMap {
    peakTrough: InteractionModeFunction;
  }
}

// Shades Saturday/Sunday behind the line so weekends are visible at a glance.
// Draws in `beforeDraw` (before the grid/axes render) so gridlines stay visible
// on top of the fill instead of being covered by it.
const weekendShadingPlugin: Plugin<'line'> = {
  id: 'weekendShading',
  beforeDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    if (!chartArea || !xScale) return;

    const dayStart = new Date(xScale.min);
    dayStart.setHours(0, 0, 0, 0);

    ctx.save();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
    while (dayStart.getTime() < xScale.max) {
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const dayOfWeek = dayStart.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        const xStart = xScale.getPixelForValue(Math.max(dayStart.getTime(), xScale.min));
        const xEnd = xScale.getPixelForValue(Math.min(dayEnd.getTime(), xScale.max));
        ctx.fillRect(xStart, chartArea.top, xEnd - xStart, chartArea.bottom - chartArea.top);
      }

      dayStart.setDate(dayStart.getDate() + 1);
    }
    ctx.restore();
  },
};

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, ChartTooltip, TimeScale, zoomPlugin, weekendShadingPlugin);

// Custom interaction mode: snaps hover/tooltip to the nearest local extremum
// (a tide peak or trough) rather than the nearest raw data point, so scrubbing
// across the line jumps between highs and lows instead of stepping through
// every point in between.
Interaction.modes.peakTrough = (chart, e: ChartEvent) => {
  const meta = chart.getDatasetMeta(0);
  const elements = meta.data;
  const values = (chart.data.datasets[0]?.data ?? []) as { y: number }[];
  if (!elements || elements.length === 0 || values.length !== elements.length) return [];

  const extremaIndices: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    const prev = values[i - 1].y;
    const curr = values[i].y;
    const next = values[i + 1].y;
    if ((curr > prev && curr > next) || (curr < prev && curr < next)) {
      extremaIndices.push(i);
    }
  }
  if (extremaIndices.length === 0) return [];

  const position = getRelativePosition(e, chart);
  let closestIndex = extremaIndices[0];
  let closestDistance = Infinity;
  for (const idx of extremaIndices) {
    const element = elements[idx];
    if (!element) continue;
    const distance = Math.abs(element.x - position.x);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = idx;
    }
  }
  return [{ element: elements[closestIndex], datasetIndex: 0, index: closestIndex }];
};

interface Props {
  predictions: TidePredictionResponse | undefined;
  analysis: LowestTideAnalysis | undefined;
  isLoading: boolean;
  onShiftDays: (days: number) => void;
  year: number;
  month: number;
  day: number;
}

// Color stops for 12AM → 12PM (mirrored for PM → AM)
//  0h = #6b21a8 (purple)
//  3h = #1e3a8a (deep blue)
//  6h = #0ea5e9 (sky blue)
//  9h = #eab308 (yellow)
// 12h = #f59e0b (amber)
interface ColorStop { pos: number; r: number; g: number; b: number }

const COLOR_STOPS: ColorStop[] = [
  { pos: 0.0, r: 107, g: 33, b: 168 }, // #6b21a8
  { pos: 0.25, r: 30, g: 58, b: 138 }, // #1e3a8a
  { pos: 0.5, r: 14, g: 165, b: 233 }, // #0ea5e9
  { pos: 0.75, r: 234, g: 179, b: 8 }, // #eab308
  { pos: 1.0, r: 245, g: 158, b: 11 }, // #f59e0b
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

const JUMP_FIELD_BASE =
  'px-2 py-1 text-xs font-medium text-gray-200 bg-gray-700 border border-gray-600 rounded-md';

interface JumpDateFieldProps {
  value: string;
  min: string;
  max: string;
  onChange: (value: string) => void;
}

// A native date input keeps the platform calendar picker, but its displayed
// value always carries the year and the segments it's built from can't be
// restyled portably (the `::-webkit-datetime-edit-*` pseudo-elements are
// Chromium-only, and hiding just the year field strands its separator). So the
// label below is our own, drawn underneath a transparent copy of the real
// input.
//
// The input itself has to be the thing the user actually taps. Mobile browsers
// only open their date picker in response to a real tap on the control - they
// ignore programmatic focus, and not all of them expose `showPicker()` - so
// routing the interaction through a separate button left the field dead on
// mobile. Desktop is the reverse: clicking a date input focuses a segment
// without opening the calendar, since only the (invisible here) indicator icon
// does that, hence the `showPicker()` nudge on click.
function JumpDateField({ value, min, max, onChange }: JumpDateFieldProps) {
  function openPicker(el: HTMLInputElement) {
    if (typeof el.showPicker !== 'function') return;
    try {
      el.showPicker();
    } catch {
      // Browsers that already opened their own picker on this tap reject the
      // duplicate call; the picker the user wanted is on screen either way.
    }
  }

  return (
    <span className="relative inline-flex rounded-md focus-within:ring-1 focus-within:ring-cyan-400">
      <span aria-hidden="true" className={`${JUMP_FIELD_BASE} whitespace-nowrap`}>
        {value ? format(parseISO(value), 'EEE, MMM d') : 'Date'}
      </span>
      <input
        type="date"
        aria-label="Jump to date"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => openPicker(e.currentTarget)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </span>
  );
}

export default function TideChart({ predictions, analysis, isLoading, onShiftDays, year, month, day }: Props) {
  const chartRef = useRef<ChartJS<'line'>>(null);
  const [dateInput, setDateInput] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [xRange, setXRange] = useState<{ min: number; max: number } | null>(null);

  // `predictions` only changes reference once a genuinely new dataset has
  // landed (React Query keeps the previous reference during a background
  // refetch via keepPreviousData, and structural sharing skips it entirely
  // if a revalidation returns identical data). That makes it a reliable
  // signal that the loaded range actually changed, so reset any zoom left
  // over from the previous range here rather than leaving it stale and
  // pointing at data that may no longer exist.
  const [predictionsForZoom, setPredictionsForZoom] = useState(predictions);
  if (predictions !== predictionsForZoom) {
    setPredictionsForZoom(predictions);
    setXRange(null);
    setDateInput('');
    setTimeInput('');
  }

  // The chart's active/hover elements are imperative chart.js state (index
  // references into the dataset), not React state, so they're cleared here
  // via the ref rather than in the render-time adjustment above.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setActiveElements([]);
    chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
    chart.update();
  }, [predictions]);

  // The zoom plugin mutates the chart's x-scale bounds directly on user pan/zoom.
  // Mirror that into React state so the declarative `options.scales.x` below stays
  // in sync, since react-chartjs-2 shallow-merges a fresh `options` object onto the
  // chart on every render and would otherwise silently wipe an imperative-only zoom.
  const syncXRangeFromChart = useCallback((chart: ChartJS) => {
    const xScale = chart.scales.x;
    if (xScale) setXRange({ min: xScale.min, max: xScale.max });
  }, []);

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

  const now = new Date().getTime();

  const currentIdx = useMemo(() => {
    if (!predictions || predictions.dataPoints.length === 0) return -1;
    const points = predictions.dataPoints;
    const first = parseISO(points[0].timestamp).getTime();
    const last = parseISO(points[points.length - 1].timestamp).getTime();
    if (now < first || now > last) return -1;

    let closestIdx = 0;
    let closestDiff = Infinity;
    points.forEach((dp, i) => {
      const diff = Math.abs(parseISO(dp.timestamp).getTime() - now);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
    });
    return closestIdx;
  }, [predictions, now]);

  const lowestIdx = useMemo(() => {
    if (!predictions || !analysis) return -1;
    return predictions.dataPoints.findIndex((dp) => dp.timestamp === analysis.lowestTide.timestamp);
  }, [predictions, analysis]);

  const pointRadii = useMemo(() => {
    if (!predictions) return [];
    return predictions.dataPoints.map((_, i) => (i === currentIdx || i === lowestIdx ? 6 : 0));
  }, [predictions, currentIdx, lowestIdx]);

  const pointColors = useMemo(() => {
    if (!predictions) return [];
    return predictions.dataPoints.map((_, i) => {
      if (i === currentIdx) return '#67e8f9';
      if (i === lowestIdx) return 'oklch(70.4% 0.191 22.216)';
      return 'transparent';
    });
  }, [predictions, currentIdx, lowestIdx]);

  // Reproduces exactly what mousing over a point on the line would show, and
  // re-centers the visible x-axis window on that point, preserving whatever
  // zoom width is currently in effect. Runs directly in the inputs' onChange
  // handlers (not an effect) since it's driven by a discrete user action and
  // needs the chart's pre-update scale bounds to compute the new center.
  const handleJumpChange = useCallback((nextDate: string, nextTime: string) => {
    const points = predictions?.dataPoints ?? [];
    const first = points.length > 0 ? parseISO(points[0].timestamp).getTime() : 0;
    const last = points.length > 0 ? parseISO(points[points.length - 1].timestamp).getTime() : 0;

    // The input carries min/max, but not every picker enforces them - mobile
    // ones in particular will happily hand back a day outside the range. Clamp
    // before it reaches state, otherwise the field sits there showing a date
    // the chart has no data for while the jump silently does nothing.
    // `yyyy-MM-dd` compares correctly as a string, so no parsing needed.
    let date = nextDate;
    if (date && points.length > 0) {
      const lo = format(first, 'yyyy-MM-dd');
      const hi = format(last, 'yyyy-MM-dd');
      if (date < lo) date = lo;
      else if (date > hi) date = hi;
    }

    setDateInput(date);
    setTimeInput(nextTime);

    const chart = chartRef.current;
    if (!chart) return;

    const clearHover = () => {
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      chart.update();
    };

    if ((!date && !nextTime) || points.length === 0) {
      clearHover();
      return;
    }

    // Either picker works on its own: an unset date falls back to the start of
    // the loaded range (which is what the time-only input has always jumped
    // within), and an unset time falls back to midnight on the chosen date.
    let targetYear = year;
    let targetMonth = month;
    let targetDay = day;
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return;
      targetYear = y;
      targetMonth = m;
      targetDay = d;
    }

    let hours = 0;
    let minutes = 0;
    if (nextTime) {
      [hours, minutes] = nextTime.split(':').map(Number);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return;
    }

    // Even an in-range day can overshoot once the time is applied, since the
    // data starts and ends partway through its boundary days. Pin to the edge
    // rather than dropping the jump.
    const rawTs = new Date(targetYear, targetMonth - 1, targetDay, hours, minutes).getTime();
    const targetTs = Math.min(Math.max(rawTs, first), last);

    let idx = 0;
    let closestDiff = Infinity;
    points.forEach((dp, i) => {
      const diff = Math.abs(parseISO(dp.timestamp).getTime() - targetTs);
      if (diff < closestDiff) {
        closestDiff = diff;
        idx = i;
      }
    });

    const targetX = chartPoints[idx].x;
    const dataMin = chartPoints[0].x;
    const dataMax = chartPoints[chartPoints.length - 1].x;
    const xScale = chart.scales.x;
    const halfWidth = (xScale.max - xScale.min) / 2;
    let newMin = targetX - halfWidth;
    let newMax = targetX + halfWidth;
    if (newMin < dataMin) {
      newMax += dataMin - newMin;
      newMin = dataMin;
    }
    if (newMax > dataMax) {
      newMin -= newMax - dataMax;
      newMax = dataMax;
    }
    newMin = Math.max(newMin, dataMin);
    newMax = Math.min(newMax, dataMax);
    setXRange({ min: newMin, max: newMax });

    const element = chart.getDatasetMeta(0).data[idx];
    if (!element) return;
    chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
    chart.tooltip?.setActiveElements([{ datasetIndex: 0, index: idx }], { x: element.x, y: element.y });
    chart.update();
  }, [predictions, year, month, day, chartPoints]);

  const handleResetZoom = useCallback(() => {
    chartRef.current?.resetZoom();
    setXRange(null);
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

  // Scopes the jump-to-date picker to the loaded range, so its calendar can only
  // reach days the chart actually holds data for.
  const rangeStart = format(chartPoints[0].x, 'yyyy-MM-dd');
  const rangeEnd = format(chartPoints[chartPoints.length - 1].x, 'yyyy-MM-dd');
  const hasJump = Boolean(dateInput || timeInput);
  const jumpFieldClass = `${JUMP_FIELD_BASE} focus:outline-none focus:ring-1 focus:ring-cyan-400`;

  const data = {
    datasets: [
      {
        data: chartPoints,
        borderWidth: 2,
        pointRadius: pointRadii,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors.map((c) => (c === 'transparent' ? 'transparent' : '#1f2937')),
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

  const datum = predictions?.station.datum;

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'peakTrough',
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
        ...(xRange ? { min: xRange.min, max: xRange.max } : {}),
      },
      y: {
        title: {
          display: true,
          // Canada and the US publish against different datums, so the bare number
          // is ambiguous without saying what zero means here.
          text: datum ? `Water Level (m above ${datum})` : 'Water Level (m)',
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
        // Without explicit limits, pan/zoom have no bound at all and will
        // happily scroll or zoom past the edges of the loaded data into
        // empty space, since nothing beyond it has been fetched.
        limits: {
          x: { min: chartPoints[0].x, max: chartPoints[chartPoints.length - 1].x },
        },
        pan: {
          enabled: true,
          mode: 'x' as const,
          onPanComplete: ({ chart }) => syncXRangeFromChart(chart),
        },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: 'x' as const,
          onZoomComplete: ({ chart }) => syncXRangeFromChart(chart),
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
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-400">Jump to</span>
            <JumpDateField
              value={dateInput}
              min={rangeStart}
              max={rangeEnd}
              onChange={(v) => handleJumpChange(v, timeInput)}
            />
            <input
              type="time"
              aria-label="Jump to time"
              value={timeInput}
              onChange={(e) => handleJumpChange(dateInput, e.target.value)}
              className={jumpFieldClass}
            />
            {hasJump && (
              <button
                onClick={() => handleJumpChange('', '')}
                aria-label="Clear jump-to"
                className="px-1.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
              >
                &times;
              </button>
            )}
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
      <div className="flex sm:hidden flex-wrap items-center justify-center gap-1.5 mt-1.5">
        <span className="text-xs font-medium text-gray-400">Jump to</span>
        <JumpDateField
          value={dateInput}
          min={rangeStart}
          max={rangeEnd}
          onChange={(v) => handleJumpChange(v, timeInput)}
        />
        <input
          type="time"
          aria-label="Jump to time"
          value={timeInput}
          onChange={(e) => handleJumpChange(dateInput, e.target.value)}
          className={jumpFieldClass}
        />
        {hasJump && (
          <button
            onClick={() => handleJumpChange('', '')}
            aria-label="Clear jump-to"
            className="px-1.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
          >
            &times;
          </button>
        )}
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
        <span className="hidden sm:inline-block w-px h-4 bg-gray-700" aria-hidden="true"></span>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(148, 163, 184, 0.35)' }}></span>
          Weekend
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-cyan-300 rounded-full"></span>
          Current tide
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: 'oklch(70.4% 0.191 22.216)' }}></span>
          Lowest tide
        </div>
      </div>
    </div>
  );
}
