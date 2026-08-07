export interface Station {
  id: string;
  code: string;
  officialName: string;
  latitude: number;
  longitude: number;
  operating: boolean;
  timeZone: string;
  source: 'Iwls' | 'Noaa';
  /** Vertical datum heights are measured from - differs between Canada and the US. */
  datum: string;
}

export interface TideDataPoint {
  timestamp: string;
  value: number;
}

export interface TidePredictionResponse {
  station: Station;
  from: string;
  to: string;
  dataPoints: TideDataPoint[];
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
