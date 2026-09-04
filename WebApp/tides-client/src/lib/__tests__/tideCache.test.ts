import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { TidePredictionResponse } from '../../types';

// The cache calls the API module directly, so that is what gets stubbed - the point of these
// tests is what the cache does with a source response, not how the fetch is made.
const getTidePredictions = vi.fn();
vi.mock('../../api/tidesApi', () => ({
  getTidePredictions: (...args: unknown[]) => getTidePredictions(...args),
}));

const { getCachedTidePredictions, clearCache } = await import('../../api/tideCache');

const STATION = {
  id: 'kits', code: '07735', officialName: 'Kitsilano', latitude: 49.27, longitude: -123.15,
  operating: true, timeZone: 'America/Vancouver', source: 'Iwls' as const, country: 'Canada',
  datum: 'Chart Datum',
};

/** The days in [from, to), counted in UTC so the runner's own zone can't shift them. */
function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const day = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (day < end) {
    days.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return days;
}

/** A response in the API's own shape: one point an hour across [from, to), naive local time. */
function response(from: string, to: string, valueAt: (day: string, hour: number) => number): TidePredictionResponse {
  const dataPoints = eachDay(from, to).flatMap((day) =>
    Array.from({ length: 24 }, (_, hour) => ({
      timestamp: `${day}T${String(hour).padStart(2, '0')}:00:00`,
      value: valueAt(day, hour),
    })),
  );
  return { station: STATION, from, to, dataPoints, extrema: [] };
}

beforeEach(() => {
  clearCache();
  getTidePredictions.mockReset();
});

afterEach(() => clearCache());

describe('getCachedTidePredictions', () => {
  it('hands back exactly what the source published for the range', async () => {
    // The whole point of the layer: caching must not alter a single height on its way to the chart.
    const source = response('2026-09-03', '2026-09-06', (_, hour) => hour / 10);
    getTidePredictions.mockResolvedValue(source);

    const result = await getCachedTidePredictions('07735', '2026-09-03', '2026-09-06');

    expect(result.dataPoints).toEqual(source.dataPoints);
  });

  it('only fetches the part of a range it does not already hold', async () => {
    getTidePredictions
      .mockResolvedValueOnce(response('2026-09-03', '2026-09-05', (_, h) => h))
      .mockResolvedValueOnce(response('2026-09-05', '2026-09-07', (_, h) => h));

    await getCachedTidePredictions('07735', '2026-09-03', '2026-09-05');
    await getCachedTidePredictions('07735', '2026-09-03', '2026-09-07');

    expect(getTidePredictions).toHaveBeenCalledTimes(2);
    // The second call asks only for the days beyond what the first one brought back.
    expect(getTidePredictions.mock.calls[1]).toEqual(['07735', '2026-09-05', '2026-09-07']);
  });

  it('asks for nothing at all when the range is already covered', async () => {
    getTidePredictions.mockResolvedValue(response('2026-09-03', '2026-09-07', (_, h) => h));

    await getCachedTidePredictions('07735', '2026-09-03', '2026-09-07');
    const inner = await getCachedTidePredictions('07735', '2026-09-04', '2026-09-06');

    expect(getTidePredictions).toHaveBeenCalledTimes(1);
    expect(inner.dataPoints.length).toBeGreaterThan(0);
    expect(inner.dataPoints.every((p) => p.timestamp >= '2026-09-04' && p.timestamp < '2026-09-06')).toBe(true);
  });

  it('keeps one point per timestamp when ranges overlap', async () => {
    // Overlapping fetches are ordinary - shifting the window by a week refetches six days of it -
    // and a duplicated timestamp would draw the wave over itself.
    getTidePredictions
      .mockResolvedValueOnce(response('2026-09-03', '2026-09-06', (_, h) => h))
      .mockResolvedValueOnce(response('2026-09-04', '2026-09-08', (_, h) => h));

    await getCachedTidePredictions('07735', '2026-09-03', '2026-09-06');
    const merged = await getCachedTidePredictions('07735', '2026-09-03', '2026-09-08');

    const timestamps = merged.dataPoints.map((p) => p.timestamp);
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });

  it('returns points in timestamp order however the ranges arrived', async () => {
    getTidePredictions
      .mockResolvedValueOnce(response('2026-09-05', '2026-09-07', (_, h) => h))
      .mockResolvedValueOnce(response('2026-09-03', '2026-09-05', (_, h) => h));

    await getCachedTidePredictions('07735', '2026-09-05', '2026-09-07');
    const merged = await getCachedTidePredictions('07735', '2026-09-03', '2026-09-07');

    const timestamps = merged.dataPoints.map((p) => p.timestamp);
    expect(timestamps).toEqual([...timestamps].sort());
  });

  it('excludes the end date, so a range covers the days it names and no more', async () => {
    // This one has bitten before: slicing through the end of `to` made the chart a day wider
    // than the analysis endpoint, so the wave could show a low the "Lowest" summary had never
    // considered - and the extra day came from whatever wider fetch had run earlier.
    getTidePredictions.mockResolvedValue(response('2026-09-03', '2026-09-08', (_, h) => h));

    await getCachedTidePredictions('07735', '2026-09-03', '2026-09-08');
    const threeDays = await getCachedTidePredictions('07735', '2026-09-03', '2026-09-06');

    const days = new Set(threeDays.dataPoints.map((p) => p.timestamp.slice(0, 10)));
    expect([...days].sort()).toEqual(['2026-09-03', '2026-09-04', '2026-09-05']);
  });

  it('keeps stations apart', async () => {
    getTidePredictions
      .mockResolvedValueOnce(response('2026-09-03', '2026-09-04', () => 1))
      .mockResolvedValueOnce(response('2026-09-03', '2026-09-04', () => 9));

    const first = await getCachedTidePredictions('07735', '2026-09-03', '2026-09-04');
    const second = await getCachedTidePredictions('9447130', '2026-09-03', '2026-09-04');

    expect(first.dataPoints[0].value).toBe(1);
    expect(second.dataPoints[0].value).toBe(9);
    expect(getTidePredictions).toHaveBeenCalledTimes(2);
  });
});
