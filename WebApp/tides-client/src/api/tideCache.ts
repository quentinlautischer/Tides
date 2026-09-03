import type { Station, TideDataPoint, TideExtremum, TidePredictionResponse } from '../types';
import { getTidePredictions as fetchFromApi } from './tidesApi';

interface CachedStation {
  station: Station | null;
  points: TideDataPoint[];
  extrema: TideExtremum[];
  /** Sorted, non-overlapping intervals that have been fetched [from, to] as yyyy-MM-dd */
  fetched: { from: string; to: string }[];
}

const cache = new Map<string, CachedStation>();

function getOrCreate(code: string): CachedStation {
  let entry = cache.get(code);
  if (!entry) {
    entry = { station: null, points: [], extrema: [], fetched: [] };
    cache.set(code, entry);
  }
  return entry;
}

/** Find date-string gaps in fetched intervals for a requested [from, to] range. */
function findGaps(fetched: { from: string; to: string }[], from: string, to: string): { from: string; to: string }[] {
  const gaps: { from: string; to: string }[] = [];
  let cursor = from;

  for (const interval of fetched) {
    if (interval.from > to || interval.to < cursor) continue;
    if (interval.from > cursor) {
      gaps.push({ from: cursor, to: interval.from });
    }
    if (interval.to > cursor) {
      cursor = interval.to;
    }
  }

  if (cursor < to) {
    gaps.push({ from: cursor, to });
  }

  return gaps;
}

/** Merge a new interval into the sorted fetched list, coalescing overlaps. */
function mergeInterval(fetched: { from: string; to: string }[], newInterval: { from: string; to: string }) {
  fetched.push(newInterval);
  fetched.sort((a, b) => a.from.localeCompare(b.from));

  // Coalesce overlapping/adjacent intervals
  const merged: { from: string; to: string }[] = [fetched[0]];
  for (let i = 1; i < fetched.length; i++) {
    const last = merged[merged.length - 1];
    if (fetched[i].from <= last.to) {
      last.to = fetched[i].to > last.to ? fetched[i].to : last.to;
    } else {
      merged.push(fetched[i]);
    }
  }

  fetched.length = 0;
  fetched.push(...merged);
}

/** Insert new points into the sorted, deduped points array. */
function mergePoints(existing: TideDataPoint[], newPoints: TideDataPoint[]): TideDataPoint[] {
  const map = new Map<string, TideDataPoint>();
  for (const p of existing) map.set(p.timestamp, p);
  for (const p of newPoints) map.set(p.timestamp, p);
  return Array.from(map.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/** Insert new extrema into the sorted, deduped extrema array. */
function mergeExtrema(existing: TideExtremum[], newExtrema: TideExtremum[]): TideExtremum[] {
  const map = new Map<string, TideExtremum>();
  for (const e of existing) map.set(e.timestamp, e);
  for (const e of newExtrema) map.set(e.timestamp, e);
  return Array.from(map.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Slice cached points to the half-open range [from, to) - `to` is the day after the last one
 * requested, so a 3-day range covers three days.
 *
 * This deliberately matches the window the API resolves for the same dates. Slicing through the
 * end of `to` instead, as this once did, made the chart a day wider than the analysis endpoint,
 * so a low could be drawn on the chart that the "Lowest" summary had never considered - and,
 * because the cache accumulates across ranges, the extra day came from whatever wider fetch
 * happened to have run earlier.
 */
function slicePoints<T extends { timestamp: string }>(points: T[], from: string, to: string): T[] {
  return points.filter((p) => p.timestamp >= from && p.timestamp < to);
}

/**
 * Get tide predictions for a station + date range, fetching only uncached gaps.
 * Returns the same shape as the raw API response.
 */
export async function getCachedTidePredictions(
  code: string,
  from: string,
  to: string,
): Promise<TidePredictionResponse> {
  const entry = getOrCreate(code);
  const gaps = findGaps(entry.fetched, from, to);

  const fetches = gaps.map((gap) => fetchFromApi(code, gap.from, gap.to));
  const results = await Promise.all(fetches);

  for (const result of results) {
    entry.points = mergePoints(entry.points, result.dataPoints);
    entry.extrema = mergeExtrema(entry.extrema, result.extrema ?? []);
    mergeInterval(entry.fetched, { from: result.from.slice(0, 10), to: result.to.slice(0, 10) });
    entry.station = result.station;
  }

  return {
    station: entry.station!,
    from,
    to,
    dataPoints: slicePoints(entry.points, from, to),
    extrema: slicePoints(entry.extrema, from, to),
  };
}

export function clearCache(code?: string) {
  if (code) {
    cache.delete(code);
  } else {
    cache.clear();
  }
}
