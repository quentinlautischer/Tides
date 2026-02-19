import type { Station, TideDataPoint, TidePredictionResponse } from '../types';
import { getTidePredictions as fetchFromApi } from './tidesApi';

interface CachedStation {
  station: Station | null;
  points: TideDataPoint[];
  /** Sorted, non-overlapping intervals that have been fetched [from, to] as yyyy-MM-dd */
  fetched: { from: string; to: string }[];
}

const cache = new Map<string, CachedStation>();

function getOrCreate(code: string): CachedStation {
  let entry = cache.get(code);
  if (!entry) {
    entry = { station: null, points: [], fetched: [] };
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

/** Slice cached points to the requested [from, to] range (inclusive by date prefix). */
function slicePoints(points: TideDataPoint[], from: string, to: string): TideDataPoint[] {
  return points.filter((p) => p.timestamp >= from && p.timestamp < to + 'T\uffff');
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
    mergeInterval(entry.fetched, { from: result.from.slice(0, 10), to: result.to.slice(0, 10) });
    entry.station = result.station;
  }

  return {
    station: entry.station!,
    from,
    to,
    dataPoints: slicePoints(entry.points, from, to),
  };
}

export function clearCache(code?: string) {
  if (code) {
    cache.delete(code);
  } else {
    cache.clear();
  }
}
