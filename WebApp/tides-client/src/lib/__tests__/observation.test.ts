import { describe, it, expect } from 'vitest';
import { observationJumpTarget } from '../observation';
import type { Observation } from '../../types';

function observation(observedLocal: string): Observation {
  return {
    id: 397016222,
    observedLocal,
    timeZone: 'America/Vancouver',
    latitude: 49.2734,
    longitude: -123.1553,
    placeGuess: 'Kitsilano Beach, Vancouver, BC',
    uri: 'https://www.inaturalist.org/observations/397016222',
  };
}

describe('observationJumpTarget', () => {
  it('splits the sighting into the date and time the jump-to fields hold', () => {
    expect(observationJumpTarget(observation('2026-09-03T07:42:00'))).toEqual({
      date: '2026-09-03',
      time: '07:42',
    });
  });

  it('drops seconds, which the chart has no field for', () => {
    expect(observationJumpTarget(observation('2026-09-03T07:42:37')).time).toBe('07:42');
  });

  // The API sends a wall clock at the place of the sighting, carrying no offset. Parsing it into
  // a Date would read it in the reader's own zone and hand back a moment shifted by their offset
  // from the station - plausible-looking, and hours out. These two sit at the ends of the day,
  // where any such conversion rolls the date rather than just nudging the clock: one fails in a
  // zone east of the reference, the other in a zone west of it.
  it('keeps midnight on its own date', () => {
    expect(observationJumpTarget(observation('2026-09-03T00:00:00'))).toEqual({
      date: '2026-09-03',
      time: '00:00',
    });
  });

  it('keeps the last minute of the day on its own date', () => {
    expect(observationJumpTarget(observation('2026-09-03T23:59:00'))).toEqual({
      date: '2026-09-03',
      time: '23:59',
    });
  });
});
