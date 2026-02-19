import type { Station, TidePredictionResponse, LowestTideAnalysis } from '../types';

const BASE = '/api';

export async function searchStations(query: string): Promise<Station[]> {
  const res = await fetch(`${BASE}/stations?search=${encodeURIComponent(query)}`);
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

export async function getTideAnalysis(
  code: string,
  from: string,
  to: string,
): Promise<LowestTideAnalysis> {
  const res = await fetch(`${BASE}/tides/${code}/analysis?from=${from}&to=${to}`);
  if (!res.ok) throw new Error('Failed to fetch tide analysis');
  return res.json();
}
