import { useMemo } from 'react';
import { getDaysInMonth } from 'date-fns';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface Props {
  year: number;
  month: number;
  day: number;
  onChange: (year: number, month: number, day: number) => void;
}

export default function DatePicker({ year, month, day, onChange }: Props) {
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = currentYear - 2; y <= currentYear + 2; y++) list.push(y);
    return list;
  }, [currentYear]);

  const daysInMonth = getDaysInMonth(new Date(year, month - 1));

  function handleMonthChange(m: number) {
    const maxDay = getDaysInMonth(new Date(year, m - 1));
    onChange(year, m, Math.min(day, maxDay));
  }

  function handleYearChange(y: number) {
    const maxDay = getDaysInMonth(new Date(y, month - 1));
    onChange(y, month, Math.min(day, maxDay));
  }

  const selectClass =
    'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none appearance-none cursor-pointer';

  return (
    <div>
      <label className="block text-sm font-medium text-gray-400 mb-1">Date</label>
      <div className="flex gap-2">
        <select
          value={month}
          onChange={(e) => handleMonthChange(Number(e.target.value))}
          className={`${selectClass} flex-1 min-w-0`}
        >
          {MONTHS.map((name, i) => (
            <option key={i} value={i + 1}>{name}</option>
          ))}
        </select>
        <select
          value={day}
          onChange={(e) => onChange(year, month, Number(e.target.value))}
          className={`${selectClass} w-18`}
        >
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => handleYearChange(Number(e.target.value))}
          className={`${selectClass} w-24`}
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
