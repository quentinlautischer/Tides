import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

const CANADA_CENTER: [number, number] = [56.1, -96.0];
const DEFAULT_ZOOM = 3;
const STATION_ZOOM = 10;

function FlyToStation({ station }: { station: Station | null }) {
  const map = useMap();
  useEffect(() => {
    if (station) {
      map.flyTo([station.latitude, station.longitude], STATION_ZOOM, { duration: 1.5 });
    } else {
      map.flyTo(CANADA_CENTER, DEFAULT_ZOOM, { duration: 1.5 });
    }
  }, [map, station]);
  return null;
}

interface Props {
  station: Station | null;
}

export default function StationMap({ station }: Props) {
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden h-full">
      <div className="h-[200px] sm:h-[220px]">
        <MapContainer
          center={station ? [station.latitude, station.longitude] : CANADA_CENTER}
          zoom={station ? STATION_ZOOM : DEFAULT_ZOOM}
          scrollWheelZoom={true}
          zoomControl={false}
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FlyToStation station={station} />
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
    </div>
  );
}
