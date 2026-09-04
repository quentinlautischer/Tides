import { useState, useMemo, useRef, useCallback } from 'react';
import { format, addDays } from 'date-fns';
import Layout from './components/Layout';
import StationPickerDialog from './components/StationPickerDialog';
import DatePicker from './components/DatePicker';
import RangeSelector from './components/RangeSelector';
import TideChart from './components/TideChart';
import type { TideChartHandle } from './components/TideChart';
import ObservationJumpDialog from './components/ObservationJumpDialog';
import LowestTidesTable from './components/LowestTidesTable';
import CurrentTideTile from './components/CurrentTideTile';
import ErrorBoundary from './components/ErrorBoundary';
import { useTidePredictions, useTideAnalysis, useCurrentTideLevel } from './hooks/useTidePredictions';
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
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSightingOpen, setIsSightingOpen] = useState(false);
  // Carries a sequence number so picking the same table row twice re-centres the chart on it
  // rather than being swallowed as an unchanged value.
  const [chartFocus, setChartFocus] = useState<{ timestamp: string; seq: number } | null>(null);

  function handleFocusTide(timestamp: string) {
    setChartFocus((previous) => ({ timestamp, seq: (previous?.seq ?? 0) + 1 }));
  }

  // Lets the observation lookup point the chart at a sighting without the chart's jump-to state
  // having to be lifted out of it.
  const chartHandle = useRef<TideChartHandle>(null);

  const handleObservationJump = useCallback((date: string, time: string) => {
    chartHandle.current?.jumpTo(date, time);
  }, []);

  function handleSelectStation(station: Station) {
    setSelectedStation(station);
    localStorage.setItem('selectedStation', JSON.stringify(station));
  }

  const { fromStr, toStr } = useMemo(() => {
    const fromDate = new Date(year, month - 1, day);
    const toDate = addDays(fromDate, rangeDays);
    return {
      fromStr: format(fromDate, 'yyyy-MM-dd'),
      toStr: format(toDate, 'yyyy-MM-dd'),
    };
  }, [year, month, day, rangeDays]);

  // The chart's jump-to picker is unbounded, so a date outside the loaded range moves the range
  // onto it rather than being refused. Starting the range half its own length before the target
  // leaves the target in the middle of the chart once the new data lands.
  function handleJumpOutOfRange(target: Date) {
    const start = addDays(target, -Math.floor(rangeDays / 2));
    setYear(start.getFullYear());
    setMonth(start.getMonth() + 1);
    setDay(start.getDate());
  }

  function handleShiftDays(days: number) {
    const current = new Date(year, month - 1, day);
    const shifted = addDays(current, days);
    setYear(shifted.getFullYear());
    setMonth(shifted.getMonth() + 1);
    setDay(shifted.getDate());
  }

  const stationCode = selectedStation?.code ?? null;
  const predictions = useTidePredictions(stationCode, fromStr, toStr);
  const analysis = useTideAnalysis(stationCode, fromStr, toStr);
  const current = useCurrentTideLevel(stationCode);

  const isError = predictions.isError || analysis.isError;

  return (
    <Layout
      headerAside={
        <CurrentTideTile
          current={current.data}
          station={selectedStation}
          isLoading={current.isLoading}
          variant="compact"
        />
      }
    >
      {/* The header has no room for this on a phone, so the full card stays in the body there
          and the header copy is hidden instead. Both read the one query in this component. */}
      <div className="sm:hidden">
        <CurrentTideTile current={current.data} station={selectedStation} isLoading={current.isLoading} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <DatePicker
          year={year}
          month={month}
          day={day}
          onChange={(y, m, d) => { setYear(y); setMonth(m); setDay(d); }}
        />
        <RangeSelector selectedDays={rangeDays} onChange={setRangeDays} />
      </div>

      {isError && (
        <div className="bg-red-900/30 border border-red-800 text-red-400 rounded-lg px-4 py-3 text-sm">
          Failed to load tide data. Please try again.
        </div>
      )}

      {selectedStation && (
        <ErrorBoundary>
          <TideChart
            ref={chartHandle}
            predictions={predictions.data}
            analysis={analysis.data}
            isLoading={predictions.isLoading}
            onShiftDays={handleShiftDays}
            onChangeStation={() => setIsPickerOpen(true)}
            onOpenSighting={() => setIsSightingOpen(true)}
            onJumpOutOfRange={handleJumpOutOfRange}
            year={year}
            month={month}
            day={day}
            focus={chartFocus}
          />
          <LowestTidesTable
            analysis={analysis.data}
            isLoading={analysis.isLoading}
            onSelect={handleFocusTide}
          />
        </ErrorBoundary>
      )}

      {!selectedStation && (
        <div className="text-center py-16 text-gray-500">
          <div className="text-5xl mb-4">🌊</div>
          <p className="text-lg">Pick a station to see its tides</p>
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Choose a station
          </button>
        </div>
      )}

      <StationPickerDialog
        open={isPickerOpen}
        selectedStation={selectedStation}
        onSelect={handleSelectStation}
        onClose={() => setIsPickerOpen(false)}
      />

      <ObservationJumpDialog
        open={isSightingOpen}
        selectedStation={selectedStation}
        onSelectStation={handleSelectStation}
        onJump={handleObservationJump}
        onClose={() => setIsSightingOpen(false)}
      />
    </Layout>
  );
}

export default App;
