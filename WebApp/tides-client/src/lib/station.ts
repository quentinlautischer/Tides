import type { Station } from '../types';

/**
 * How a station is named anywhere it's shown to the user.
 *
 * Names alone are ambiguous now that both countries are covered - there is a Vancouver
 * on each side of the border - so the country goes with the name everywhere.
 *
 * Falls back to the bare name when the country is missing, which is the case for a
 * station that was selected before this field existed and is still sitting in
 * localStorage from that session.
 */
export function stationLabel(station: Station): string {
  return station.country ? `${station.officialName}, ${station.country}` : station.officialName;
}
