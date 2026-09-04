import { useMemo, useRef, useCallback, useState, useEffect, useImperativeHandle } from 'react';
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
import type { KeyboardEvent } from 'react';
import type { Ref } from 'react';
import type { ChartOptions, ChartEvent, ChartType, InteractionModeFunction, Plugin } from 'chart.js';
import INaturalistIcon from './INaturalistIcon';
import WaveLoader from './WaveLoader';
import { useLoadingMessage } from '../hooks/useLoadingMessage';
import { stationLabel } from '../lib/station';
import type { Station, TidePredictionResponse, LowestTideAnalysis } from '../types';

/**
 * Where the jump-to crosshair is drawn, handed to its plugin through `options.plugins`.
 * Null while nothing is selected, or while the selection sits outside the loaded data.
 */
interface JumpMarkerOptions {
  ts: number | null;
  value: number | null;
  label: string;
}

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
    jumpMarker: JumpMarkerOptions;
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

/**
 * The two-line label block, measured from the turning point it belongs to. `ABOVE` and `BELOW`
 * are the first line's baseline on each side; the second sits `LINE_HEIGHT` further out, and
 * `ASCENT` is how far the 11px text reaches above its own baseline.
 */
const LABEL_OFFSET_ABOVE = 20;
const LABEL_OFFSET_BELOW = 16;
const LABEL_LINE_HEIGHT = 12;
const LABEL_ASCENT = 9;
/** Clear space between the text and the edge of the plate drawn behind it. */
const LABEL_PAD = 4;

const HIGH_COLOR = '#94a3b8';
const LOW_COLOR = '#fca5a5';
const LOWEST_COLOR = 'oklch(70.4% 0.191 22.216)';
const JUMP_COLOR = '#f97316';

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

      // Labels are written into the chart rather than out of it: a high's text goes below its
      // peak and a low's above its trough. A turning point is by definition closest to the edge
      // it is a turning point towards, so labelling outward is labelling into the one place
      // there is no room - which is what was clipping them against the top of the plot.
      const isLow = point.kind === 'Low';
      const fitsAbove = element.y - LABEL_OFFSET_ABOVE - LABEL_ASCENT >= chartArea.top;
      const fitsBelow = element.y + LABEL_OFFSET_BELOW + LABEL_LINE_HEIGHT <= chartArea.bottom;
      // Falls back to the outward side where the inward one somehow has no room, and keeps the
      // inward one when neither fits, since flipping would only trade one clipped label for another.
      const drawAbove = isLow ? (fitsAbove || !fitsBelow) : (!fitsBelow && fitsAbove);

      const valueY = drawAbove ? element.y - LABEL_OFFSET_ABOVE : element.y + LABEL_OFFSET_BELOW;

      // Labelling inward puts the text over the curve rather than in clear air beside it, so it
      // gets the panel's own colour behind it. Without this the line runs straight through the
      // digits and the label reads as being under the chart instead of on top of it.
      const boxTop = valueY - LABEL_ASCENT - LABEL_PAD;
      const boxHeight = LABEL_ASCENT + LABEL_LINE_HEIGHT + LABEL_PAD * 2;
      ctx.fillStyle = 'rgba(31, 41, 55, 0.85)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(element.x - halfWidth - LABEL_PAD, boxTop, halfWidth * 2 + LABEL_PAD * 2, boxHeight, 4);
      } else {
        ctx.rect(element.x - halfWidth - LABEL_PAD, boxTop, halfWidth * 2 + LABEL_PAD * 2, boxHeight);
      }
      ctx.fill();

      ctx.fillStyle = isLow ? LOW_COLOR : HIGH_COLOR;
      ctx.fillText(valueText, element.x, valueY);
      ctx.fillStyle = '#9ca3af';
      ctx.fillText(timeText, element.x, valueY + LABEL_LINE_HEIGHT);
    }

    ctx.restore();
  },
};

// Marks the jump-to selection with a crosshair that stays put. The jump used to be shown by
// driving Chart.js's own active element and tooltip, but those are hover state: the first mouse
// move across the chart wiped the selection the user had just made. Drawing it from the plugin's
// own options instead means it survives hovering, panning and zooming, and only the Clear button
// takes it away.
const jumpMarkerPlugin: Plugin<'line', JumpMarkerOptions> = {
  id: 'jumpMarker',
  defaults: { ts: null, value: null, label: '' },
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!chartArea || !xScale || !yScale) return;
    if (opts.ts == null || opts.value == null) return;
    if (opts.ts < xScale.min || opts.ts > xScale.max) return;

    const x = xScale.getPixelForValue(opts.ts);
    const y = yScale.getPixelForValue(opts.value);
    const ring = 6;
    // The arms stop short of the ring, so the two don't smear into a blob at the intersection.
    const gap = ring + 3;

    ctx.save();

    ctx.strokeStyle = 'rgba(249, 115, 22, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, Math.max(chartArea.top, y - gap));
    ctx.moveTo(x, Math.min(chartArea.bottom, y + gap));
    ctx.lineTo(x, chartArea.bottom);
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(Math.max(chartArea.left, x - gap), y);
    ctx.moveTo(Math.min(chartArea.right, x + gap), y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(x, y, ring, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(31, 41, 55, 0.9)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = JUMP_COLOR;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 1.75, 0, Math.PI * 2);
    ctx.fillStyle = JUMP_COLOR;
    ctx.fill();

    // No tooltip reports the jump any more, so the marker carries its own time and height.
    if (opts.label) {
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const height = 18;
      const width = ctx.measureText(opts.label).width + 12;
      const boxX = Math.min(Math.max(x - width / 2, chartArea.left + 2), chartArea.right - width - 2);
      // Sits above the point, flipping below it when there is no room at the top.
      let boxY = y - gap - 5 - height;
      if (boxY < chartArea.top + 2) boxY = y + gap + 5;

      ctx.beginPath();
      ctx.roundRect(boxX, boxY, width, height, 4);
      ctx.fillStyle = 'rgba(31, 41, 55, 0.95)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = JUMP_COLOR;
      ctx.stroke();

      ctx.fillStyle = '#fdba74';
      ctx.fillText(opts.label, boxX + width / 2, boxY + height / 2 + 0.5);
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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, ChartTooltip, TimeScale, zoomPlugin, weekendShadingPlugin, extremaLabelsPlugin, jumpMarkerPlugin);

/** What the chart lets a parent drive from outside, for actions that come from elsewhere. */
export interface TideChartHandle {
  /** Point the chart at a date (`yyyy-MM-dd`) and time (`HH:mm`), exactly as the fields would. */
  jumpTo: (date: string, time: string) => void;
}

interface Props {
  /**
   * Exposes {@link TideChartHandle}. The jump is a discrete user action raised by a sibling
   * component, so it is handed over imperatively rather than as state watched by an effect -
   * which would also mean setting state from inside an effect on every jump.
   */
  ref?: Ref<TideChartHandle>;
  predictions: TidePredictionResponse | undefined;
  analysis: LowestTideAnalysis | undefined;
  /**
   * The station the chart is being asked about, which is known before its data is - so the
   * heading, and with it the way to change station, can be drawn in every state.
   */
  station: Station | null;
  isLoading: boolean;
  /** A fetch is in flight over data already on screen, which is left visible underneath. */
  isFetching: boolean;
  /** The data couldn't be loaded at all, as opposed to loading fine and being empty. */
  isError: boolean;
  onShiftDays: (days: number) => void;
  /** Opens the station picker. The chart's heading names the station, so the swap belongs there. */
  onChangeStation: () => void;
  /** Opens the sighting lookup, which drives this chart's jump-to - hence the button beside it. */
  onOpenSighting: () => void;
  /**
   * Asks for the loaded range to be moved onto a jump-to date it doesn't cover. The picker is
   * unbounded, so this is how a date beyond the loaded window is honoured rather than refused.
   */
  onJumpOutOfRange: (target: Date) => void;
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

/** A resolved jump-to selection. `loaded` is false when the chart holds no data for that day. */
interface JumpTarget {
  ts: number;
  loaded: boolean;
  value: number;
}

/**
 * Turns the two jump-to fields into a point on the chart.
 *
 * Either field works on its own: an unset date falls back to the start of the loaded range
 * (which is what the time-only input has always jumped within) and an unset time to midnight.
 * Coverage is judged by calendar day, so a time landing just outside the partially-loaded
 * boundary days pins to the edge instead of asking for a range that is already on screen.
 */
function resolveJumpTarget(
  date: string,
  time: string,
  fallback: { year: number; month: number; day: number },
  points: { x: number; y: number }[],
): JumpTarget | null {
  if ((!date && !time) || points.length === 0) return null;

  let targetYear = fallback.year;
  let targetMonth = fallback.month;
  let targetDay = fallback.day;
  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
    targetYear = y;
    targetMonth = m;
    targetDay = d;
  }

  let hours = 0;
  let minutes = 0;
  if (time) {
    [hours, minutes] = time.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  }

  const wanted = new Date(targetYear, targetMonth - 1, targetDay, hours, minutes).getTime();
  const dataMin = points[0].x;
  const dataMax = points[points.length - 1].x;
  // `yyyy-MM-dd` compares correctly as a string, so no parsing needed.
  const wantedDay = format(wanted, 'yyyy-MM-dd');
  if (wantedDay < format(dataMin, 'yyyy-MM-dd') || wantedDay > format(dataMax, 'yyyy-MM-dd')) {
    return { ts: wanted, loaded: false, value: 0 };
  }

  const ts = Math.min(Math.max(wanted, dataMin), dataMax);
  // Read the height off the line at the requested time rather than snapping to the nearest
  // sample, so the crosshair sits where the user pointed even when zoomed in far enough to see
  // the gap between samples.
  let i = 0;
  while (i < points.length - 2 && points[i + 1].x <= ts) i++;
  const before = points[i];
  const after = points[i + 1] ?? before;
  const span = after.x - before.x;
  const frac = span > 0 ? Math.min(Math.max((ts - before.x) / span, 0), 1) : 0;
  return { ts, loaded: true, value: before.y + (after.y - before.y) * frac };
}

interface JumpDateFieldProps {
  value: string;
  display: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
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
function JumpDateField({ value, display, onChange, onKeyDown }: JumpDateFieldProps) {
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
        {display}
      </span>
      <input
        type="date"
        aria-label="Jump to date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onClick={(e) => openPicker(e.currentTarget)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </span>
  );
}

// The station name and the way to change it. Drawn in every state the chart can be in -
// loading, empty, failed, drawn - because it carries the only route back to the picker: with
// no chart there is no other control on the page once a station has been chosen.
function StationHeading({ station, onChangeStation }: { station: Station | null; onChangeStation: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-lg font-semibold text-gray-100">
        Tide Levels{station && <> &mdash; {stationLabel(station)}</>}
      </h2>
      <button
        type="button"
        onClick={onChangeStation}
        title="Change station"
        className="inline-flex items-center gap-1 rounded-md bg-gray-700 px-2 py-1 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-600"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="M4 8h13l-3-3M20 16H7l3 3" />
        </svg>
        Change
      </button>
    </div>
  );
}

const SHIFT_BUTTON_CLASS = 'px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors';

function ShiftDaysButtons({ onShiftDays }: { onShiftDays: (days: number) => void }) {
  return (
    <>
      <button onClick={() => onShiftDays(-30)} className={SHIFT_BUTTON_CLASS}>&laquo; 30d</button>
      <button onClick={() => onShiftDays(-7)} className={SHIFT_BUTTON_CLASS}>&lsaquo; 7d</button>
      <button onClick={() => onShiftDays(7)} className={SHIFT_BUTTON_CLASS}>7d &rsaquo;</button>
      <button onClick={() => onShiftDays(30)} className={SHIFT_BUTTON_CLASS}>30d &raquo;</button>
    </>
  );
}

function FindingTides({ message, className = '' }: { message: string; className?: string }) {
  return (
    <span className={`flex items-center gap-2 text-sm text-gray-300 ${className}`}>
      <WaveLoader className="h-4 w-8 text-cyan-300" />
      {message}
    </span>
  );
}

// The sighting lookup fills the jump-to fields for you, so it is offered as the iNaturalist
// mark at the end of that row rather than as another panel further down the page.
function SightingButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Jump to an iNaturalist sighting"
      aria-label="Jump to an iNaturalist sighting"
      // Deliberately the jump-to fields' own colours: it sits in their row and reads as one of them.
      className="inline-flex items-center justify-center rounded-md border border-gray-600 bg-gray-700 p-1 transition-colors hover:bg-gray-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
    >
      <INaturalistIcon className="h-4 w-4" />
    </button>
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

export default function TideChart({ ref, predictions, analysis, station, isLoading, isFetching, isError, onShiftDays, onChangeStation, onOpenSighting, onJumpOutOfRange, year, month, day, focus }: Props) {
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

  // Where the crosshair goes, recomputed whenever the fields or the loaded data change.
  const jumpTarget = useMemo(
    () => resolveJumpTarget(dateInput, timeInput, { year, month, day }, chartPoints),
    [dateInput, timeInput, year, month, day, chartPoints],
  );

  // Brings a selection into view. A date the loaded range doesn't cover asks the parent to move
  // the range onto it, which lands the target in the middle of the fresh chart on its own.
  // Otherwise the window pans so the target sits in the middle - unless it is already on screen,
  // since panning out from under the user for a point they can already see is just jarring.
  const revealJump = useCallback((target: JumpTarget | null) => {
    if (!target) return;
    if (!target.loaded) {
      onJumpOutOfRange(new Date(target.ts));
      return;
    }

    const chart = chartRef.current;
    const xScale = chart?.scales.x;
    if (!chart || !xScale) return;
    if (target.ts >= xScale.min && target.ts <= xScale.max) return;
    centreOn(chart, target.ts);
  }, [centreOn, onJumpOutOfRange]);

  // Runs from the inputs' own handlers rather than an effect, since it is driven by a discrete
  // user action and needs the chart's pre-update scale bounds to decide where to pan.
  const handleJumpChange = useCallback((nextDate: string, nextTime: string) => {
    setDateInput(nextDate);
    setTimeInput(nextTime);
    revealJump(resolveJumpTarget(nextDate, nextTime, { year, month, day }, chartPoints));
  }, [year, month, day, chartPoints, revealJump]);

  useImperativeHandle(ref, () => ({ jumpTo: handleJumpChange }), [handleJumpChange]);

  // Enter is the natural way to be done with a native date or time picker, but neither control
  // does anything with it on its own. Blurring closes whatever the browser popped open, and
  // re-revealing means Enter also brings the marker back after panning away from it by hand.
  const handleJumpKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.currentTarget.blur();
    revealJump(jumpTarget);
  }, [jumpTarget, revealJump]);

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

  const loadingMessage = useLoadingMessage(isLoading || isFetching);

  const headingStation = predictions?.station ?? station;

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 sm:p-6">
        <StationHeading station={headingStation} onChangeStation={onChangeStation} />
        <div className="mt-4 flex h-64 flex-col items-center justify-center gap-3 rounded-lg bg-gray-700/30">
          <WaveLoader className="h-12 w-24 text-cyan-400" />
          <span className="text-sm text-gray-300">{loadingMessage}</span>
        </div>
      </div>
    );
  }

  // Nothing to draw, which is not the same as nothing to do: the heading and the range controls
  // stay, so a station with no data here - or one that failed outright - can still be moved off.
  if (!predictions || chartPoints.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 sm:p-6">
        <StationHeading station={headingStation} onChangeStation={onChangeStation} />
        <p className="mt-3 text-sm text-gray-400">
          {isError
            ? "This station's tides could not be loaded."
            : 'No tide data was published for this station over the dates chosen.'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Try another date range, or change to a different station.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ShiftDaysButtons onShiftDays={onShiftDays} />
        </div>
      </div>
    );
  }

  const hasJump = Boolean(dateInput || timeInput);
  // The field draws its own label, so it can leave the year off while the target is in the year
  // already on screen and spell it out once the jump leaves that year.
  const jumpDateLabel = dateInput
    ? format(parseISO(dateInput), Number(dateInput.slice(0, 4)) === year ? 'EEE, MMM d' : 'MMM d, yyyy')
    : 'Date';

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
      jumpMarker: {
        ts: jumpTarget?.loaded ? jumpTarget.ts : null,
        value: jumpTarget?.loaded ? jumpTarget.value : null,
        label: jumpTarget?.loaded
          ? `${format(jumpTarget.ts, 'MMM d, h:mm a')} · ${jumpTarget.value.toFixed(2)}m`
          : '',
      },
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
          <StationHeading station={headingStation} onChangeStation={onChangeStation} />
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
            <ShiftDaysButtons onShiftDays={onShiftDays} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-400">Jump to</span>
            <JumpDateField
              value={dateInput}
              display={jumpDateLabel}
              onChange={(v) => handleJumpChange(v, timeInput)}
              onKeyDown={handleJumpKeyDown}
            />
            <input
              type="time"
              aria-label="Jump to time"
              value={timeInput}
              onChange={(e) => handleJumpChange(dateInput, e.target.value)}
              onKeyDown={handleJumpKeyDown}
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
            <SightingButton onClick={onOpenSighting} />
          </div>
        </div>
      </div>
      <div className="relative w-full h-[320px] touch-none">
        <Line ref={chartRef} data={data} options={options} />
        {/* Over the old data rather than instead of it: the shape stays readable while the new
            range loads, and the scrim stops it being read as current or panned around. */}
        {isFetching && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-gray-800/70">
            <FindingTides message={loadingMessage} className="rounded-full bg-gray-900/90 px-3 py-1.5 shadow-lg" />
          </div>
        )}
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
          display={jumpDateLabel}
          onChange={(v) => handleJumpChange(v, timeInput)}
          onKeyDown={handleJumpKeyDown}
        />
        <input
          type="time"
          aria-label="Jump to time"
          value={timeInput}
          onChange={(e) => handleJumpChange(dateInput, e.target.value)}
          onKeyDown={handleJumpKeyDown}
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
        <SightingButton onClick={onOpenSighting} />
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
        {jumpTarget?.loaded && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: JUMP_COLOR }}></span>
            Jump to
          </div>
        )}
      </div>
    </div>
  );
}
