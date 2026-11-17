import {
  agentDefinitionSchema,
  type AgentKey,
  agentVersionSchema,
  type CreateDesignSystem,
  designSystemSchema,
  designSystemSummarySchema,
  metricsSchema,
  projectDesignSchema,
  type RunEvent,
  runEventSchema,
  runSchema,
  screensResponseSchema,
  type SourceEdit,
  sourceEditResultSchema,
  studioConfigSchema,
  type UpdateAgent,
  type UpdateDesignSystem,
} from '@core-studio/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiGet, apiSend } from '../../lib/api-client';

export const studioKeys = {
  config: ['studio', 'config'] as const,
  screens: (projectId: string) => ['studio', 'screens', projectId] as const,
  runs: (projectId: string) => ['studio', 'runs', projectId] as const,
  design: (projectId: string) => ['studio', 'design', projectId] as const,
  agents: (teamId: string) => ['studio', 'agents', teamId] as const,
  agentVersions: (teamId: string, key: string) =>
    ['studio', 'agents', teamId, key, 'versions'] as const,
  systems: (teamId: string) => ['studio', 'systems', teamId] as const,
  system: (teamId: string, slug: string) => ['studio', 'systems', teamId, slug] as const,
  metrics: (teamId: string, days: number) => ['studio', 'metrics', teamId, days] as const,
};

export function useStudioConfig() {
  return useQuery({
    queryKey: studioKeys.config,
    queryFn: ({ signal }) => apiGet('/api/v1/studio/config', studioConfigSchema, signal),
    staleTime: Infinity,
  });
}

export function useScreens(projectId: string) {
  return useQuery({
    queryKey: studioKeys.screens(projectId),
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/projects/${projectId}/screens`, screensResponseSchema, signal),
  });
}

export function useRuns(projectId: string) {
  return useQuery({
    queryKey: studioKeys.runs(projectId),
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/projects/${projectId}/runs`, z.array(runSchema), signal),
  });
}

export function useProjectDesign(projectId: string) {
  return useQuery({
    queryKey: studioKeys.design(projectId),
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/projects/${projectId}/design`, projectDesignSchema, signal),
  });
}

export function useStartRun(projectId: string) {
  return useMutation({
    mutationFn: (prompt: string) =>
      apiSend('POST', `/api/v1/projects/${projectId}/runs`, {
        body: { prompt },
        schema: z.object({ id: z.uuid() }),
      }),
  });
}

/**
 * Follows a run's server-sent events (same-origin, cookie session). Events are schema-validated;
 * unknown ones are ignored. Returns the events received so far and whether the run finished.
 */
export function useRunEvents(projectId: string, runId: string | null, onDone: () => void) {
  const [state, setState] = useState<{
    runId: string | null;
    events: RunEvent[];
    finished: boolean;
    /** The stream closed for good before `done` (e.g. signed out, server gone). */
    lost: boolean;
  }>({
    runId: null,
    events: [],
    finished: false,
    lost: false,
  });
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/api/v1/projects/${projectId}/runs/${runId}/events`);
    source.onmessage = (message: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }
      const parsed = runEventSchema.safeParse(data);
      if (!parsed.success) return;
      const event = parsed.data;
      const finished = event.type === 'done';
      setState((current) =>
        current.runId === runId
          ? {
              runId,
              events: [...current.events, event],
              finished: current.finished || finished,
              lost: false,
            }
          : { runId, events: [event], finished, lost: false },
      );
      if (finished) {
        source.close();
        done.current();
      }
    };
    // The browser reconnects by itself (resuming via Last-Event-ID) while readyState is CONNECTING.
    // CLOSED means it gave up: stop waiting and refresh, so the run list shows the real outcome.
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) return;
      setState((current) =>
        current.runId === runId
          ? { ...current, lost: !current.finished }
          : { runId, events: [], finished: false, lost: true },
      );
      done.current();
    };
    return () => {
      source.close();
    };
  }, [projectId, runId]);
  const current = state.runId === runId;
  return {
    events: current ? state.events : [],
    finished: current && state.finished,
    lost: current && state.lost,
  };
}

export function useSourceEdit(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (edit: SourceEdit) =>
      apiSend('POST', `/api/v1/projects/${projectId}/source-edits`, {
        body: edit,
        schema: sourceEditResultSchema,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: studioKeys.screens(projectId) });
    },
  });
}

export function useDesignMutations(projectId: string) {
  const client = useQueryClient();
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: studioKeys.design(projectId) }),
      client.invalidateQueries({ queryKey: studioKeys.screens(projectId) }),
    ]);
  return {
    apply: useMutation({
      mutationFn: (slug: string) =>
        apiSend('POST', `/api/v1/projects/${projectId}/design/apply`, {
          body: { slug },
          schema: projectDesignSchema,
        }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (body: { designMd: string; tokensCss: string; baseRevision: number }) =>
        apiSend('PUT', `/api/v1/projects/${projectId}/design`, {
          body,
          schema: projectDesignSchema,
        }),
      onSuccess: refresh,
    }),
  };
}

// ---------- team library ----------

export function useAgents(teamId: string) {
  return useQuery({
    queryKey: studioKeys.agents(teamId),
    queryFn: ({ signal }) =>
      apiGet('/api/v1/studio/agents', z.array(agentDefinitionSchema), signal),
  });
}

export function useAgentVersions(teamId: string, key: AgentKey | null) {
  return useQuery({
    queryKey: studioKeys.agentVersions(teamId, key ?? ''),
    enabled: key !== null,
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/studio/agents/${key ?? ''}/versions`, z.array(agentVersionSchema), signal),
  });
}

export function useAgentMutations(teamId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: studioKeys.agents(teamId) });
  return {
    update: useMutation({
      mutationFn: ({ key, ...body }: UpdateAgent & { key: AgentKey }) =>
        apiSend('PUT', `/api/v1/studio/agents/${key}`, { body, schema: agentDefinitionSchema }),
      onSuccess: refresh,
    }),
    revert: useMutation({
      mutationFn: ({
        key,
        toVersion,
        expectedVersion,
      }: {
        key: AgentKey;
        toVersion: number;
        expectedVersion: number;
      }) =>
        apiSend('POST', `/api/v1/studio/agents/${key}/revert`, {
          body: { toVersion, expectedVersion },
          schema: agentDefinitionSchema,
        }),
      onSuccess: refresh,
    }),
  };
}

export function useDesignSystems(teamId: string) {
  return useQuery({
    queryKey: studioKeys.systems(teamId),
    queryFn: ({ signal }) =>
      apiGet('/api/v1/studio/design-systems', z.array(designSystemSummarySchema), signal),
  });
}

export function useDesignSystem(teamId: string, slug: string | null) {
  return useQuery({
    queryKey: studioKeys.system(teamId, slug ?? ''),
    enabled: slug !== null,
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/studio/design-systems/${slug ?? ''}`, designSystemSchema, signal),
  });
}

export function useDesignSystemMutations(teamId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['studio', 'systems', teamId] });
  return {
    update: useMutation({
      mutationFn: ({ slug, ...body }: UpdateDesignSystem & { slug: string }) =>
        apiSend('PUT', `/api/v1/studio/design-systems/${slug}`, {
          body,
          schema: designSystemSchema,
        }),
      onSuccess: refresh,
    }),
    create: useMutation({
      mutationFn: (body: CreateDesignSystem) =>
        apiSend('POST', '/api/v1/studio/design-systems', { body, schema: designSystemSchema }),
      onSuccess: refresh,
    }),
  };
}

export function useMetrics(teamId: string, days: number) {
  return useQuery({
    queryKey: studioKeys.metrics(teamId, days),
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/studio/metrics?days=${String(days)}`, metricsSchema, signal),
  });
}
