const RANGES = [
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
  { label: '2 months', days: 60 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year', days: 365 },
];

interface Props {
  selectedDays: number;
  onChange: (days: number) => void;
}

export default function RangeSelector({ selectedDays, onChange }: Props) {
  return (
    <div className="flex flex-col h-full">
      <label className="block text-sm font-medium text-gray-400 mb-1">Range</label>
      <div className="flex flex-wrap gap-2 items-start">
        {RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => onChange(r.days)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedDays === r.days
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
