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
import type { ChartOptions, ChartEvent, ChartType, InteractionModeFunction, Plugin } from 'chart.js';
import { stationLabel } from '../lib/station';
import type { TidePredictionResponse, LowestTideAnalysis } from '../types';

declare module 'chart.js' {
  interface InteractionModeMap {
    magneticExtrema: InteractionModeFunction;
  }

  // Both switches live here rather than in component state alone, so the label plugin and the
  // interaction mode - neither of which can see React state - read the same values.
  // The type parameter is part of the interface being augmented, not ours to drop.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    extremaMarkers: { labels: boolean; snap: boolean };
  }
}

/** The extrema dataset is charted alongside the wave, as the second dataset. */
const EXTREMA_DATASET = 1;

/**
 * How close the pointer has to get, horizontally, before hover snaps to a turning point.
 * Capped as a fraction of the on-screen gap between neighbouring turning points as well: at a
 * month's zoom they sit ~50px apart, and a flat 24px band there would cover almost the whole
 * curve, putting every ordinary time back out of reach - the problem the snap-only mode had.
 */
const SNAP_RADIUS_PX = 24;
const SNAP_RADIUS_FRACTION = 0.25;

/** Minimum clear space between two drawn labels before the later one is dropped. */
const LABEL_GAP_PX = 8;

const HIGH_COLOR = '#94a3b8';
const LOW_COLOR = '#fca5a5';
const LOWEST_COLOR = 'oklch(70.4% 0.191 22.216)';

/**
 * A turning point positioned on the chart. `kind` rides along on the dataset so the label
 * and tooltip can tell a high from a low; Chart.js parses `x`/`y` and ignores the rest.
 */
interface ExtremaPoint {
  x: number;
  y: number;
  kind: 'High' | 'Low';
  timestamp: string;
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

// Prints each turning point's height and time next to it, so the numbers the app exists to
// surface are readable without hovering - which matters most on touch, where there is no hover
// and landing a tap on a peak is the hard part. Labels are dropped rather than allowed to
// collide, so a month-wide view keeps only the well-separated ones and the rest fill back in
// on zoom, with no per-range thresholds to tune.
const extremaLabelsPlugin: Plugin<'line'> = {
  id: 'extremaMarkers',
  defaults: { labels: false, snap: true },
  afterDatasetsDraw(chart) {
    if (!chart.options.plugins?.extremaMarkers?.labels) return;

    const meta = chart.getDatasetMeta(EXTREMA_DATASET);
    const points = chart.data.datasets[EXTREMA_DATASET]?.data as unknown as ExtremaPoint[] | undefined;
    if (!meta || !points) return;

    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
    ctx.clip();
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';

    let lastRight = -Infinity;
    for (let i = 0; i < meta.data.length; i++) {
      const element = meta.data[i];
      const point = points[i];
      if (!element || !point) continue;
      if (element.x < chartArea.left || element.x > chartArea.right) continue;

      const valueText = `${point.y.toFixed(2)}m`;
      const timeText = format(point.x, 'h:mm a');
      const halfWidth = Math.max(ctx.measureText(valueText).width, ctx.measureText(timeText).width) / 2;
      if (element.x - halfWidth < lastRight + LABEL_GAP_PX) continue;
      lastRight = element.x + halfWidth;

      // Lows label downward and highs upward, so the text never lands on the line itself.
      const isLow = point.kind === 'Low';
      const valueY = isLow ? element.y + 16 : element.y - 20;
      ctx.fillStyle = isLow ? LOW_COLOR : HIGH_COLOR;
      ctx.fillText(valueText, element.x, valueY);
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(timeText, element.x, valueY + 12);
    }

    ctx.restore();
  },
};

// Hover snaps to a turning point when the pointer is near one and reads the raw 15-minute
// series everywhere else. Snapping unconditionally (what this replaced) made the peaks easy to
// hit but put every other time of day out of reach; plain nearest-point made the peaks - the
// only points anyone is aiming for - the hardest thing on the chart to land on.
Interaction.modes.magneticExtrema = (chart, e: ChartEvent) => {
  const position = getRelativePosition(e, chart);

  if (chart.options.plugins?.extremaMarkers?.snap) {
    const extremaMeta = chart.getDatasetMeta(EXTREMA_DATASET);
    let closest = -1;
    let closestDistance = Infinity;
    for (let i = 0; i < extremaMeta.data.length; i++) {
      const distance = Math.abs(extremaMeta.data[i].x - position.x);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = i;
      }
    }
    if (closest >= 0) {
      const neighbours = [extremaMeta.data[closest - 1], extremaMeta.data[closest + 1]]
        .filter(Boolean)
        .map((n) => Math.abs(n.x - extremaMeta.data[closest].x));
      const spacing = neighbours.length > 0 ? Math.min(...neighbours) : Infinity;
      const radius = Math.min(SNAP_RADIUS_PX, spacing * SNAP_RADIUS_FRACTION);

      if (closestDistance <= radius) {
        return [{ element: extremaMeta.data[closest], datasetIndex: EXTREMA_DATASET, index: closest }];
      }
    }
  }

  const meta = chart.getDatasetMeta(0);
  const points = (chart.data.datasets[0]?.data ?? []) as { x: number }[];
  if (points.length === 0 || meta.data.length !== points.length) return [];

  // Binary search rather than a scan: a year of predictions is ~35k points and this runs on
  // every pointer move.
  const target = chart.scales.x.getValueForPixel(position.x);
  if (target == null) return [];

  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].x - target) <= Math.abs(points[lo].x - target)) lo -= 1;

  return [{ element: meta.data[lo], datasetIndex: 0, index: lo }];
};

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, ChartTooltip, TimeScale, zoomPlugin, weekendShadingPlugin, extremaLabelsPlugin);

interface Props {
  predictions: TidePredictionResponse | undefined;
  analysis: LowestTideAnalysis | undefined;
  isLoading: boolean;
  onShiftDays: (days: number) => void;
  year: number;
  month: number;
  day: number;
  /**
   * A turning point to centre and open the tooltip on, driven by the lowest-tides table.
   * Carries a sequence number so picking the same row twice re-focuses it.
   */
  focus: { timestamp: string; seq: number } | null;
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

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  title: string;
}

// A labelled switch rather than a button that merely changes colour: with two of these sitting
// side by side, "which one is currently on" has to be legible without clicking either.
function ToggleSwitch({ checked, onChange, label, title }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={onChange}
      className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
        checked
          ? 'bg-gray-700 text-gray-100 border-gray-600'
          : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700 hover:text-gray-300'
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative inline-block h-3.5 w-6 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-cyan-500' : 'bg-gray-600'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-2.5' : 'translate-x-0'
          }`}
        />
      </span>
      {label}
    </button>
  );
}

export default function TideChart({ predictions, analysis, isLoading, onShiftDays, year, month, day, focus }: Props) {
  const chartRef = useRef<ChartJS<'line'>>(null);
  const [dateInput, setDateInput] = useState('');
  const [timeInput, setTimeInput] = useState('');
  const [xRange, setXRange] = useState<{ min: number; max: number } | null>(null);
  // Labels start off: they're the detailed read of the chart, asked for rather than imposed.
  // The snap starts on, since it costs nothing until the pointer is near a turning point.
  const [showLabels, setShowLabels] = useState(false);
  const [snapToExtrema, setSnapToExtrema] = useState(true);

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

  // Deliberately built from `extrema` and not from `dataPoints`: these are the authority's own
  // turning points, so they sit between the 15-minute samples rather than on them.
  const extremaPoints = useMemo<ExtremaPoint[]>(() => {
    if (!predictions?.extrema) return [];
    return predictions.extrema.map((e) => ({
      x: parseISO(e.timestamp).getTime(),
      y: e.value,
      kind: e.kind,
      timestamp: e.timestamp,
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

  // The overall lowest now comes from the analysis, which ranks published turning points, so it
  // identifies one of those rather than an index into the charted series.
  const lowestExtremaIdx = useMemo(() => {
    if (!analysis || extremaPoints.length === 0) return -1;
    const lowestTs = parseISO(analysis.lowestTide.timestamp).getTime();
    return extremaPoints.findIndex((p) => p.kind === 'Low' && p.x === lowestTs);
  }, [analysis, extremaPoints]);

  const pointRadii = useMemo(() => {
    if (!predictions) return [];
    return predictions.dataPoints.map((_, i) => (i === currentIdx ? 6 : 0));
  }, [predictions, currentIdx]);

  const pointColors = useMemo(() => {
    if (!predictions) return [];
    return predictions.dataPoints.map((_, i) => (i === currentIdx ? '#67e8f9' : 'transparent'));
  }, [predictions, currentIdx]);

  // Whichever low the lowest-tides table last sent over, so it can be marked on a chart whose
  // markers are otherwise switched off. Setting it as the active element opens its tooltip but
  // does not draw it - Chart.js applies hover styling on real pointer hover, not to elements
  // activated in code - so without this the row you picked is the one point with nothing on it.
  const focusedExtremaIdx = useMemo(() => {
    if (!focus || extremaPoints.length === 0) return -1;
    const focusTs = parseISO(focus.timestamp).getTime();
    return extremaPoints.findIndex((p) => p.x === focusTs);
  }, [focus, extremaPoints]);

  // The overall lowest is the answer the app exists to give, so its marker is always drawn -
  // the same standing as the current-tide marker, and independent of the Labels switch. The
  // rest of the turning points are the detail that switch controls.
  const extremaRadii = useMemo(
    () => extremaPoints.map((_, i) => {
      if (i === lowestExtremaIdx) return 6;
      if (i === focusedExtremaIdx) return 5;
      return showLabels ? 3.5 : 0;
    }),
    [extremaPoints, lowestExtremaIdx, focusedExtremaIdx, showLabels],
  );

  const extremaColors = useMemo(
    () => extremaPoints.map((p, i) => {
      if (i === lowestExtremaIdx) return LOWEST_COLOR;
      return p.kind === 'Low' ? LOW_COLOR : HIGH_COLOR;
    }),
    [extremaPoints, lowestExtremaIdx],
  );

  // Slides the visible window so `targetX` sits in the middle of it, preserving the current
  // zoom width and stopping at the edges of the loaded data rather than scrolling past them.
  const centreOn = useCallback((chart: ChartJS, targetX: number) => {
    if (chartPoints.length === 0) return;
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
    setXRange({ min: Math.max(newMin, dataMin), max: Math.min(newMax, dataMax) });
  }, [chartPoints]);

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

    centreOn(chart, chartPoints[idx].x);

    const element = chart.getDatasetMeta(0).data[idx];
    if (!element) return;
    chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
    chart.tooltip?.setActiveElements([{ datasetIndex: 0, index: idx }], { x: element.x, y: element.y });
    chart.update();
  }, [predictions, year, month, day, chartPoints, centreOn]);

  // Picking a row in the lowest-tides table centres that low and opens its tooltip. Tapping a
  // table row is precise in a way that scrubbing for a trough is not, which is the point of the
  // cross-link.
  //
  // It deliberately leaves the Labels switch alone - that switch is the reader's choice, not
  // something a jump gets to overrule. The selected low stays visible on its own account, via
  // focusedExtremaIdx above.
  const appliedFocusSeq = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || appliedFocusSeq.current === focus.seq) return;

    const chart = chartRef.current;
    if (!chart) return;

    const targetTs = parseISO(focus.timestamp).getTime();
    const idx = extremaPoints.findIndex((p) => p.x === targetTs);
    if (idx < 0) return;

    const element = chart.getDatasetMeta(EXTREMA_DATASET).data[idx];
    if (!element) return;

    appliedFocusSeq.current = focus.seq;
    centreOn(chart, extremaPoints[idx].x);
    chart.setActiveElements([{ datasetIndex: EXTREMA_DATASET, index: idx }]);
    chart.tooltip?.setActiveElements([{ datasetIndex: EXTREMA_DATASET, index: idx }], { x: element.x, y: element.y });
    chart.update();
  }, [focus, extremaPoints, centreOn]);

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
      {
        // Drawn as its own dataset rather than as styled points on the wave, because its
        // timestamps don't line up with the 15-minute grid the wave is plotted on. That also
        // gives the markers their own hit-testable elements for the hover snap and the tooltip.
        data: extremaPoints,
        showLine: false,
        // No animation on this dataset. Panning ends with the zoom plugin writing new scale
        // bounds into React state, which re-renders and so triggers a normal animated update -
        // harmless on the wave, but it made every marker and its label slide into place on each
        // pan. The labels are read off these elements' positions, so stilling the points stills
        // the text with them.
        animation: false as const,
        // Visibility is per-point radius rather than `hidden` on the dataset: a hidden dataset
        // draws nothing at all, which would take the always-on lowest marker with it and leave
        // the snap anchoring tooltips to a point that isn't rendered.
        pointRadius: extremaRadii,
        pointBackgroundColor: extremaColors,
        pointBorderColor: '#1f2937',
        pointBorderWidth: 1.5,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: extremaColors,
      },
    ],
  };

  const datum = predictions?.station.datum;

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'magneticExtrema',
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
          label: (ctx) => {
            const height = `${(ctx.parsed.y ?? 0).toFixed(2)}m`;
            if (ctx.datasetIndex !== EXTREMA_DATASET) return `Tide Level: ${height}`;
            return `${(ctx.raw as ExtremaPoint).kind === 'Low' ? 'Low' : 'High'} tide: ${height}`;
          },
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
      extremaMarkers: { labels: showLabels, snap: snapToExtrema },
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
            Tide Levels &mdash; {stationLabel(predictions.station)}
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
          <div className="flex gap-1.5">
            <ToggleSwitch
              checked={showLabels}
              onChange={() => setShowLabels((v) => !v)}
              label="Labels"
              title="Mark each high and low with its height and time"
            />
            <ToggleSwitch
              checked={snapToExtrema}
              onChange={() => setSnapToExtrema((v) => !v)}
              label="Snap"
              title="Pull the hover onto the nearest high or low"
            />
            <button
              onClick={handleResetZoom}
              className="px-3 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
            >
              Reset Zoom
            </button>
          </div>
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
      <div className="flex sm:hidden items-center justify-center gap-1.5 mt-1.5">
        <ToggleSwitch
          checked={showLabels}
          onChange={() => setShowLabels((v) => !v)}
          label="Labels"
          title="Mark each high and low with its height and time"
        />
        <ToggleSwitch
          checked={snapToExtrema}
          onChange={() => setSnapToExtrema((v) => !v)}
          label="Snap"
          title="Pull the hover onto the nearest high or low"
        />
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
        {showLabels && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: HIGH_COLOR }}></span>
              High tide
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: LOW_COLOR }}></span>
              Low tide
            </div>
          </>
        )}
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-cyan-300 rounded-full"></span>
          Current tide
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: LOWEST_COLOR }}></span>
          Lowest tide
        </div>
      </div>
    </div>
  );
}
