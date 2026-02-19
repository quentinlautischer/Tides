import { useQuery } from '@tanstack/react-query';
import { getTidePredictions, getTideAnalysis } from '../api/tidesApi';

export function useTidePredictions(code: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['tides', code, from, to],
    queryFn: () => getTidePredictions(code!, from, to),
    enabled: !!code,
    staleTime: 1000 * 60 * 30,
  });
}

export function useTideAnalysis(code: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['analysis', code, from, to],
    queryFn: () => getTideAnalysis(code!, from, to),
    enabled: !!code,
    staleTime: 1000 * 60 * 30,
  });
}
