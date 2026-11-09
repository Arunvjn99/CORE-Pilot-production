import { healthResponseSchema } from '@core-studio/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../lib/api-client';

export function useApiHealth() {
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: ({ signal }) => apiGet('/api/v1/health/live', healthResponseSchema, signal),
    staleTime: 30_000,
  });
}
