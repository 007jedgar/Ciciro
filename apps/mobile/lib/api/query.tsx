import { useEffect, type ReactNode } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./client";

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

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
