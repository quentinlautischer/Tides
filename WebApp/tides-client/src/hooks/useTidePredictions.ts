import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getTideAnalysis, getCurrentTideLevel } from '../api/tidesApi';
import { getCachedTidePredictions } from '../api/tideCache';

export function useTidePredictions(code: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['tides', code, from, to],
    queryFn: () => getCachedTidePredictions(code!, from, to),
    enabled: !!code,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useTideAnalysis(code: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['analysis', code, from, to],
    queryFn: () => getTideAnalysis(code!, from, to),
    enabled: !!code,
    staleTime: 1000 * 60 * 30,
    placeholderData: keepPreviousData,
  });
}

export function useCurrentTideLevel(code: string | null) {
  return useQuery({
    queryKey: ['current', code],
    queryFn: () => getCurrentTideLevel(code!),
    enabled: !!code,
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });
}
