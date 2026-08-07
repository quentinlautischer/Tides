import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Tooltip, useMap, useMapEvent } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAllStations } from '../hooks/useStations';
import type { Station } from '../types';

const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Frames the whole covered area: Canada plus the US west coast.
const DEFAULT_CENTER: [number, number] = [54.0, -100.0];
const DEFAULT_ZOOM: number = 3;
const STATION_ZOOM = 10;

// Stations cluster tightly along the coasts, so dots stay small when zoomed out
// to keep the shape of the coastline readable, and grow once they spread apart.
function dotRadius(zoom: number): number {
  if (zoom <= 4) return 3;
  if (zoom <= 6) return 4;
  if (zoom <= 8) return 5;
  return 6;
}

function FlyToStation({ station, skipRef }: { station: Station | null; skipRef: React.RefObject<boolean> }) {
  const map = useMap();
  useEffect(() => {
    // A station picked by clicking its dot is already on screen - flying to it
    // would yank the user out of the overview they were browsing.
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    if (station) {
      map.flyTo([station.latitude, station.longitude], STATION_ZOOM, { duration: 1.5 });
    } else {
      map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 1.5 });
    }
  }, [map, station, skipRef]);
  return null;
}

function useZoomLevel() {
  // Seed from the map rather than a constant: it opens at STATION_ZOOM when a
  // station is already selected, and the dots have to be sized right immediately.
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvent('zoomend', (e) => setZoom(e.target.getZoom()));
  return zoom;
}

function StationDots({
  stations,
  selectedCode,
  onSelect,
}: {
  stations: Station[];
  selectedCode: string | undefined;
  onSelect: (station: Station) => void;
}) {
  const radius = dotRadius(useZoomLevel());

  return (
    <>
      {stations.map((s) => {
        const isSelected = s.code === selectedCode;
        return (
          <CircleMarker
            key={s.id}
            center={[s.latitude, s.longitude]}
            radius={isSelected ? radius + 2 : radius}
            pathOptions={{
              color: isSelected ? '#f87171' : '#38bdf8',
              weight: 1,
              fillColor: isSelected ? '#ef4444' : '#0ea5e9',
              fillOpacity: isSelected ? 1 : 0.7,
            }}
            eventHandlers={{ click: () => onSelect(s) }}
          >
            <Tooltip direction="top" offset={[0, -radius]}>
              <span className="font-medium">{s.officialName}</span>
              <span className="text-gray-500"> ({s.code})</span>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

interface Props {
  station: Station | null;
  onSelect: (station: Station) => void;
}

export default function StationMap({ station, onSelect }: Props) {
  const { data: stations, isLoading, isError } = useAllStations(true);
  const skipFlyToRef = useRef(false);

  function handleDotClick(picked: Station) {
    skipFlyToRef.current = true;
    onSelect(picked);
  }

  // Canvas keeps a thousand-odd dots smooth to pan and zoom; the tolerance gives
  // the small ones a slightly larger hit area than they're drawn at.
  const renderer = useMemo(() => L.canvas({ tolerance: 4 }), []);

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden h-full relative">
      <div className="h-[280px] sm:h-[320px]">
        <MapContainer
          center={station ? [station.latitude, station.longitude] : DEFAULT_CENTER}
          zoom={station ? STATION_ZOOM : DEFAULT_ZOOM}
          // Below this the stations collapse into an unreadable blob and most of
          // the frame is empty ocean, so there's nothing to gain by zooming out.
          minZoom={DEFAULT_ZOOM}
          scrollWheelZoom={true}
          zoomControl={false}
          renderer={renderer}
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FlyToStation station={station} skipRef={skipFlyToRef} />
          {stations && (
            <StationDots stations={stations} selectedCode={station?.code} onSelect={handleDotClick} />
          )}
          {station && (
            <Marker position={[station.latitude, station.longitude]} icon={redIcon}>
              <Popup>
                <span className="font-medium">{station.officialName}</span>
                <br />
                <span className="text-gray-500">Code: {station.code}</span>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
      <div className="absolute bottom-0 left-0 z-[500] px-2 py-1 text-xs text-gray-300 bg-gray-900/80 rounded-tr-md pointer-events-none">
        {isLoading && 'Loading stations...'}
        {isError && 'Could not load station list'}
        {stations && `${stations.length} stations - click a dot to select`}
      </div>
    </div>
  );
}
