export interface Station {
  id: string;
  code: string;
  officialName: string;
  latitude: number;
  longitude: number;
  operating: boolean;
  timeZone: string;
  source: 'Iwls' | 'Noaa';
  /** Country the station is in. May be absent on a station cached before it existed. */
  country?: string;
  /** Vertical datum heights are measured from - differs between Canada and the US. */
  datum: string;
}

export interface TideDataPoint {
  timestamp: string;
  value: number;
}

/**
 * A published tide turning point. Its timestamp is the real one, so it generally falls
 * between two `TideDataPoint`s rather than on one - these are drawn over the wave, not
 * as part of it.
 */
export interface TideExtremum {
  timestamp: string;
  value: number;
  kind: 'High' | 'Low';
}

export interface TidePredictionResponse {
  station: Station;
  from: string;
  to: string;
  dataPoints: TideDataPoint[];
  extrema: TideExtremum[];
}

export interface DailyTideSummary {
  date: string;
  lowestValue: number;
  lowestTimestamp: string;
  timeOfDay: string;
}

export interface LowestTideAnalysis {
  lowestTide: TideDataPoint;
  timeOfDay: string;
  dailyLows: DailyTideSummary[];
}

export interface CurrentTideLevel {
  value: number;
  timestamp: string;
  trend: 'Rising' | 'Falling' | 'Steady';
  source: 'Observed' | 'Predicted';
}
