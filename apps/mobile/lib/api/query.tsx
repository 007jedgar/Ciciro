import { useEffect, type ReactNode } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ApiError } from "./client";
import { CACHE_BUSTER, CACHE_MAX_AGE, queryPersister } from "./persister";

export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const queryClient = createQueryClient();

let listenersInstalled = false;

export function installQueryNetworkListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    })
  );

  if (Platform.OS !== "web") {
    focusManager.setEventListener((handleFocus) => {
      const onChange = (status: AppStateStatus) => {
        handleFocus(status === "active");
      };
      const sub = AppState.addEventListener("change", onChange);
      return () => sub.remove();
    });
  }
}

export function ApiQueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    installQueryNetworkListeners();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: CACHE_MAX_AGE,
        buster: CACHE_BUSTER,
        // Persist cached reads only. Mutations (incl. optimistic ones) are not
        // resumed from disk; a relaunch revalidates against the server instead.
        dehydrateOptions: { shouldDehydrateMutation: () => false },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
