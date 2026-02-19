import { useState, useCallback, useMemo } from 'react';
import { format, addDays } from 'date-fns';
import Layout from './components/Layout';
import StationSelector from './components/StationSelector';
import DatePicker from './components/DatePicker';
import RangeSelector from './components/RangeSelector';
import TideChart from './components/TideChart';
import StationMap from './components/StationMap';
import ErrorBoundary from './components/ErrorBoundary';
import { useTidePredictions, useTideAnalysis } from './hooks/useTidePredictions';
import type { Station } from './types';

function loadCachedStation(): Station | null {
  try {
    const raw = localStorage.getItem('selectedStation');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function App() {
  const now = new Date();
  const [selectedStation, setSelectedStation] = useState<Station | null>(loadCachedStation);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [day, setDay] = useState(now.getDate());
  const [rangeDays, setRangeDays] = useState(30);

  const handleSelectStation = useCallback((station: Station) => {
    setSelectedStation(station);
    localStorage.setItem('selectedStation', JSON.stringify(station));
  }, []);

  const { fromStr, toStr } = useMemo(() => {
    const fromDate = new Date(year, month - 1, day);
    const toDate = addDays(fromDate, rangeDays);
    return {
      fromStr: format(fromDate, 'yyyy-MM-dd'),
      toStr: format(toDate, 'yyyy-MM-dd'),
    };
  }, [year, month, day, rangeDays]);

  const handleShiftDays = useCallback((days: number) => {
    const current = new Date(year, month - 1, day);
    const shifted = addDays(current, days);
    setYear(shifted.getFullYear());
    setMonth(shifted.getMonth() + 1);
    setDay(shifted.getDate());
  }, [year, month, day]);

  const stationCode = selectedStation?.code ?? null;
  const predictions = useTidePredictions(stationCode, fromStr, toStr);
  const analysis = useTideAnalysis(stationCode, fromStr, toStr);

  const isError = predictions.isError || analysis.isError;

  return (
    <Layout>
      <div className="grid gap-4 sm:grid-cols-2">
        <StationSelector selectedStation={selectedStation} onSelect={handleSelectStation} />
        <div className="order-3 sm:order-none">
          <DatePicker
            year={year}
            month={month}
            day={day}
            onChange={(y, m, d) => { setYear(y); setMonth(m); setDay(d); }}
          />
        </div>
        <div className="order-2 sm:order-none">
          <StationMap station={selectedStation} />
        </div>
        <div className="order-4 sm:order-none">
          <RangeSelector selectedDays={rangeDays} onChange={setRangeDays} />
        </div>
      </div>

      {isError && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 rounded-lg px-4 py-3 text-sm">
          Failed to load tide data. Please try again.
        </div>
      )}

      {selectedStation && (
        <ErrorBoundary>
          <TideChart
            predictions={predictions.data}
            analysis={analysis.data}
            isLoading={predictions.isLoading}
            onShiftDays={handleShiftDays}
          />
        </ErrorBoundary>
      )}

      {!selectedStation && (
        <div className="text-center py-16 text-gray-500">
          <div className="text-5xl mb-4">🌊</div>
          <p className="text-lg">Search for a station to see tide predictions</p>
        </div>
      )}
    </Layout>
  );
}

export default App;
