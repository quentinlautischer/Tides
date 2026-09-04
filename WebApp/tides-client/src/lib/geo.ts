import type { Station } from '../types';

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The station closest to a point, with how far away it is. Returns null for an empty list, which
 * is what a caller sees before the station list has loaded.
 */
export function nearestStation(
  stations: Station[],
  latitude: number,
  longitude: number,
): { station: Station; distanceKm: number } | null {
  let best: { station: Station; distanceKm: number } | null = null;

  for (const station of stations) {
    const km = distanceKm(latitude, longitude, station.latitude, station.longitude);
    if (!best || km < best.distanceKm) best = { station, distanceKm: km };
  }

  return best;
}
