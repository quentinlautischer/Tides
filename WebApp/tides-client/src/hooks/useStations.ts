import { useQuery } from '@tanstack/react-query';
import { searchStations } from '../api/tidesApi';

export function useStations(query: string) {
  return useQuery({
    queryKey: ['stations', query],
    queryFn: () => searchStations(query),
    enabled: true,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
