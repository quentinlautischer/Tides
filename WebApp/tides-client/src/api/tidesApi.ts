import type { Station, TidePredictionResponse, LowestTideAnalysis, CurrentTideLevel, Observation } from '../types';

const BASE = '/api';

export async function searchStations(query: string): Promise<Station[]> {
  const res = await fetch(`${BASE}/stations?search=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Failed to fetch stations');
  return res.json();
}

export async function getAllStations(): Promise<Station[]> {
  const res = await fetch(`${BASE}/stations/all`);
  if (!res.ok) throw new Error('Failed to fetch stations');
  return res.json();
}

export async function getTidePredictions(
  code: string,
  from: string,
  to: string,
): Promise<TidePredictionResponse> {
  const res = await fetch(`${BASE}/tides/${code}?from=${from}&to=${to}`);
  if (!res.ok) throw new Error('Failed to fetch tide predictions');
  return res.json();
}

export async function getCurrentTideLevel(code: string): Promise<CurrentTideLevel> {
  const res = await fetch(`${BASE}/tides/${code}/current`);
  if (!res.ok) throw new Error('Failed to fetch current tide level');
  return res.json();
}

export async function getTideAnalysis(
  code: string,
  from: string,
  to: string,
): Promise<LowestTideAnalysis> {
  const res = await fetch(`${BASE}/tides/${code}/analysis?from=${from}&to=${to}`);
  if (!res.ok) throw new Error('Failed to fetch tide analysis');
  return res.json();
}

/**
 * Resolves an iNaturalist observation URL or bare id to the moment and place it was recorded.
 * Goes through our own API rather than iNaturalist directly: they ask callers to identify
 * themselves with a User-Agent, which a browser will not let a page set.
 */
export async function getObservation(reference: string): Promise<Observation> {
  const res = await fetch(`${BASE}/observations?reference=${encodeURIComponent(reference)}`);
  if (!res.ok) {
    // The API explains refusals in an `error` field - a bad reference or an unknown id - and
    // those messages are more use to the reader than a generic failure.
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? 'Failed to look up that observation');
  }
  return res.json();
}
