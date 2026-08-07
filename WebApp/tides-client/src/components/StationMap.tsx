import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Tooltip, useMap, useMapEvent } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAllStations } from '../hooks/useStations';
import { useCurrentLocation, type CurrentLocation } from '../hooks/useCurrentLocation';
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

// A marker rather than a circle path: paths share one canvas with the station dots and
// are drawn in the order they mount, so the location would end up buried under the dots
// whenever the station list resolved last. Markers get their own pane, always on top.
// Sizing lives in .tide-location-marker in index.css.
const locationIcon = new L.DivIcon({
  className: 'tide-location-marker',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  tooltipAnchor: [0, -9],
});

// Frames the whole covered area: Canada plus the US west coast.
const DEFAULT_CENTER: [number, number] = [54.0, -100.0];
const DEFAULT_ZOOM: number = 3;
const STATION_ZOOM = 10;
// Close enough to place the user in their own city, wide enough that the stations
// around them are still on screen to pick from. Wider than this and the surroundings
// stop being recognisable; tighter and there are too few stations in frame to choose.
const NEARBY_ZOOM = 9;

// Stations cluster tightly along the coasts, so dots stay small when zoomed out
// to keep the shape of the coastline readable, and grow once they spread apart.
function dotRadius(zoom: number): number {
  if (zoom <= 4) return 3;
  if (zoom <= 6) return 4;
  if (zoom <= 8) return 5;
  return 6;
}

function FlyToStation({
  station,
  location,
  skipRef,
}: {
  station: Station | null;
  location: CurrentLocation;
  skipRef: React.RefObject<boolean>;
}) {
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
    } else if (location.status === 'ready') {
      // Nothing picked yet, so open on the user's own stretch of coast rather than the
      // whole continent. This is also what puts the location marker on screen - with a
      // station selected the map goes there instead, and the marker can be well outside
      // the frame until the user zooms out.
      map.flyTo([location.latitude, location.longitude], NEARBY_ZOOM, { duration: 1.5 });
    } else {
      map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 1.5 });
    }
  }, [map, station, location, skipRef]);
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

// Only says something when there's a reason the green marker isn't there; a successful
// fix speaks for itself.
function locationNote(location: CurrentLocation): string | null {
  switch (location.status) {
    case 'locating': return 'finding you...';
    case 'denied': return 'location blocked';
    case 'unsupported': return 'location unavailable';
    case 'error': return 'location unavailable';
    default: return null;
  }
}

// Why the recentre button can't be used, or null when it can.
function locationBlockedReason(location: CurrentLocation): string | null {
  switch (location.status) {
    case 'locating': return 'Finding your location...';
    case 'denied': return 'Location access is blocked in your browser';
    case 'error': return 'Your location could not be determined';
    default: return null;
  }
}

function RecentreButton({ location, onRecentre }: { location: CurrentLocation; onRecentre: () => void }) {
  // Nothing to offer if the browser has no geolocation at all, so don't take up the
  // corner with a button that can never work.
  if (location.status === 'unsupported') return null;

  const blocked = locationBlockedReason(location);

  return (
    <button
      type="button"
      onClick={onRecentre}
      disabled={blocked !== null}
      title={blocked ?? 'Centre the map on your location'}
      aria-label={blocked ?? 'Centre the map on your location'}
      className="absolute top-2 right-2 z-[800] flex h-10 w-10 items-center justify-center rounded-full border border-gray-700 bg-gray-900/85 text-gray-200 shadow-lg transition-colors hover:bg-gray-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-900/85 disabled:hover:text-gray-200"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3.25" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    </button>
  );
}

interface Props {
  station: Station | null;
  onSelect: (station: Station) => void;
}

export default function StationMap({ station, onSelect }: Props) {
  const { data: stations, isLoading, isError } = useAllStations(true);
  // The map is only mounted once the user has asked for it, so the permission prompt
  // follows a deliberate action rather than appearing out of nowhere on page load.
  const location = useCurrentLocation(true);
  const skipFlyToRef = useRef(false);
  // Held in state rather than a ref so the recentre button re-renders once the map
  // exists and has something to act on.
  const [map, setMap] = useState<L.Map | null>(null);

  function handleRecentre() {
    if (!map || location.status !== 'ready') return;
    map.flyTo([location.latitude, location.longitude], NEARBY_ZOOM, { duration: 1.5 });
  }

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
          ref={setMap}
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
          <FlyToStation station={station} location={location} skipRef={skipFlyToRef} />
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
          {location.status === 'ready' && (
            <Marker position={[location.latitude, location.longitude]} icon={locationIcon}>
              <Tooltip direction="top">You are here</Tooltip>
            </Marker>
          )}
        </MapContainer>
      </div>
      {/* Sits outside MapContainer so its clicks never reach the map underneath. */}
      <RecentreButton location={location} onRecentre={handleRecentre} />
      {/* Top-left because the bottom of the map belongs to Leaflet's attribution, which
          this used to run into on narrow screens. */}
      <div className="absolute top-0 left-0 z-[500] px-2 py-1 text-xs text-gray-300 bg-gray-900/80 rounded-br-md pointer-events-none">
        {isLoading && 'Loading stations...'}
        {isError && 'Could not load station list'}
        {stations && `${stations.length} stations - click a dot to select`}
        {stations && locationNote(location) && ` - ${locationNote(location)}`}
      </div>
    </div>
  );
}
