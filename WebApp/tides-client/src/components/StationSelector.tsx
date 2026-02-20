import { useState, useRef, useEffect } from 'react';
import { useStations } from '../hooks/useStations';
import type { Station } from '../types';

interface Props {
  selectedStation: Station | null;
  onSelect: (station: Station) => void;
  showMap: boolean;
  onToggleMap: () => void;
}

export default function StationSelector({ selectedStation, onSelect, showMap, onToggleMap }: Props) {
  const [query, setQuery] = useState(selectedStation?.officialName ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const { data: stations, isLoading } = useStations(query);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative z-[1000]">
      <label className="block text-sm font-medium text-gray-400 mb-1">Station</label>
      <input
        type="text"
        placeholder="Search stations (e.g. Vancouver, Victoria)..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />
      {selectedStation && !isOpen && (
        <div className="mt-1 flex items-center justify-between text-sm text-gray-500">
          <span>
            Selected: <span className="font-medium text-gray-300">{selectedStation.officialName}</span> ({selectedStation.code})
          </span>
          <button
            onClick={onToggleMap}
            className="px-2.5 py-1 text-xs font-medium text-gray-400 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors"
          >
            {showMap ? 'Hide Map' : 'Show Map'}
          </button>
        </div>
      )}
      {isOpen && (
        <ul className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-60 overflow-auto">
          {isLoading && (
            <li className="px-4 py-3 text-gray-400 text-sm">Searching...</li>
          )}
          {stations && stations.length === 0 && (
            <li className="px-4 py-3 text-gray-400 text-sm">No stations found</li>
          )}
          {stations?.map((s) => (
            <li
              key={s.id}
              onClick={() => {
                onSelect(s);
                setQuery(s.officialName);
                setIsOpen(false);
              }}
              className="px-4 py-2.5 cursor-pointer hover:bg-gray-700 text-gray-100 text-sm border-b border-gray-700 last:border-b-0"
            >
              <span className="font-medium">{s.officialName}</span>
              <span className="text-gray-500 ml-2">({s.code})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
