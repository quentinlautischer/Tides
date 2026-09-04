import type { Observation } from '../types';

/**
 * The sighting's date and time as the chart's jump-to fields hold them: `yyyy-MM-dd` and `HH:mm`.
 *
 * Taken as string slices rather than through a Date on purpose. `observedLocal` is already a wall
 * clock reading at the place of the sighting and carries no offset; parsing it into a Date would
 * read it in the reader's own zone and hand back a time shifted by their offset from the station.
 *
 * Seconds are dropped: the chart's time input has none, and the tide moves imperceptibly inside
 * a minute.
 */
export function observationJumpTarget(observation: Observation): { date: string; time: string } {
  return {
    date: observation.observedLocal.slice(0, 10),
    time: observation.observedLocal.slice(11, 16),
  };
}
