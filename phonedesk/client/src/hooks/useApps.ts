import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import type { AppEntry, AppStatusSnapshot, LaunchResult } from "../types";

const APPS_QUERY_KEY = ["apps"];

export const useApps = () => {
  const queryClient = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const [statuses, setStatuses] = useState<AppStatusSnapshot>({});
  const [streamVersion, setStreamVersion] = useState(0);

  const appsQuery = useQuery({
    queryKey: APPS_QUERY_KEY,
    queryFn: async () => {
      const response = await api.get<AppEntry[]>("/apps");
      return response.data;
    },
  });

  useEffect(() => {
    if (!token) {
      setStatuses({});
      return;
    }

    const controller = new AbortController();

    void fetchEventSource("/api/apps/status", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      openWhenHidden: true,
      onmessage(event) {
        if (event.event !== "statuses") {
          return;
        }

        try {
          setStatuses(JSON.parse(event.data) as AppStatusSnapshot);
        } catch {
          setStatuses({});
        }
      },
      onerror(error) {
        throw error;
      },
    }).catch(() => {
      // Automatic retry is handled by fetchEventSource.
    });

    return () => {
      controller.abort();
    };
  }, [token, streamVersion]);

  const launchMutation = useMutation({
    mutationFn: async (appId: string) => {
      const response = await api.post<LaunchResult>(`/apps/${appId}/launch`);
      return response.data;
    },
    onMutate: async (appId: string) => {
      const previous = { ...statuses };
      setStatuses((current) => ({ ...current, [appId]: true }));
      return { previous };
    },
    onError: (_error, _appId, context) => {
      if (context?.previous) {
        setStatuses(context.previous);
      }
    },
  });

  const refreshStatuses = useCallback(() => {
    setStreamVersion((version) => version + 1);
  }, []);

  const apps = useMemo(() => appsQuery.data ?? [], [appsQuery.data]);

  return {
    apps,
    statuses,
    isLoading: appsQuery.isLoading,
    isFetching: appsQuery.isFetching,
    error: appsQuery.error,
    refetchApps: appsQuery.refetch,
    refreshStatuses,
    launchApp: launchMutation.mutateAsync,
    isLaunching: launchMutation.isPending,
    queryClient,
  };
};
