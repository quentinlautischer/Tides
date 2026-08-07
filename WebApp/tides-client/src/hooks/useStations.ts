import { useQuery } from '@tanstack/react-query';
import { getAllStations, searchStations } from '../api/tidesApi';

export function useStations(query: string) {
  return useQuery({
    queryKey: ['stations', query],
    queryFn: () => searchStations(query),
    enabled: true,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

// Full station list for the map. Only fetched once the map is actually shown,
// since it's a much larger payload than a search result page.
export function useAllStations(enabled: boolean) {
  return useQuery({
    queryKey: ['stations', 'all'],
    queryFn: getAllStations,
    enabled,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours - the station list barely changes
  });
}
