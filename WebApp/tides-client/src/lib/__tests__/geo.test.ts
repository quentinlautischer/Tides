import { describe, it, expect } from 'vitest';
import { distanceKm, nearestStation } from '../geo';
import type { Station } from '../../types';

function station(code: string, latitude: number, longitude: number): Station {
  return {
    id: code, code, officialName: code, latitude, longitude, operating: true,
    timeZone: 'America/Vancouver', source: 'Iwls', country: 'Canada', datum: 'Chart Datum',
  };
}

const VANCOUVER = station('07735', 49.2827, -123.1207);
const SEATTLE = station('9447130', 47.6062, -122.3321);
const SAN_DIEGO = station('9410170', 32.7157, -117.1611);

describe('distanceKm', () => {
  it('measures a known separation to within a kilometre', () => {
    // Vancouver to Seattle, great-circle. Checked against an independent haversine rather than
    // against this implementation, so the number is a fact about the earth and not a snapshot
    // of whatever the function happened to return the day the test was written.
    expect(distanceKm(49.2827, -123.1207, 47.6062, -122.3321)).toBeCloseTo(195.28, 1);
  });

  it('holds up over a long span too', () => {
    // Vancouver to San Diego. A small-angle approximation would drift here; haversine does not.
    expect(distanceKm(49.2827, -123.1207, 32.7157, -117.1611)).toBeCloseTo(1907.33, 1);
  });

  it('is zero for a point against itself', () => {
    expect(distanceKm(49.2827, -123.1207, 49.2827, -123.1207)).toBe(0);
  });
});

describe('nearestStation', () => {
  it('picks the closest station and says how far it is', () => {
    const result = nearestStation([SAN_DIEGO, SEATTLE, VANCOUVER], 49.2734, -123.1553);

    expect(result?.station.code).toBe('07735');
    expect(result?.distanceKm).toBeLessThan(5);
  });

  it('returns null before the station list has loaded', () => {
    // This is what a caller holds while the full list is still in flight, and it must not be
    // mistaken for "no station is near you".
    expect(nearestStation([], 49.2734, -123.1553)).toBeNull();
  });

  it('still answers for a sighting far outside the covered coast', () => {
    // Coverage is Canada plus the US west coast; a sighting in Europe resolves perfectly well
    // and the nearest station is simply a long way off, which the UI says out loud.
    const result = nearestStation([VANCOUVER, SEATTLE, SAN_DIEGO], 51.5074, -0.1278);

    expect(result).not.toBeNull();
    expect(result!.distanceKm).toBeGreaterThan(5000);
  });
});
