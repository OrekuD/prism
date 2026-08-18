import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { LocalStorageKeys } from "./constants/LocalStorageKeys";
import { initTelemetry } from "./lib/prism";

const client = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!query.meta?.error) return;
      toast.error(query.meta.error as string);
    },
  }),
  defaultOptions: {
    queries: {
      retry: 2,
    },
  },
});

// Opt-in product telemetry (v2 core, task-9 slice 6): no-op without
// VITE_TELEMETRY_KEY — the hardcoded v1 client is gone.
void initTelemetry();

const el = document.getElementById("root");
if (el) {
  const root = createRoot(el);
  root.render(
    <ThemeProvider
      defaultTheme="dark"
      storageKey={LocalStorageKeys.THEME_VALUE}
    >
      <QueryClientProvider client={client}>
        <App />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>,
  );

  // Persist the workspace/project/source queries to localStorage so a page
  // refresh restores them instantly (sidebar dropdowns don't sit on a
  // loading sketch). Scoped to those keys; maxAge guards staleness.
  void persistQueryClient({
    queryClient: client,
    persister: createSyncStoragePersister({
      key: "prism-query-cache",
      storage: window.localStorage,
    }),
    maxAge: 1000 * 60 * 60 * 24, // 24h
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => {
        const key = query.queryKey[0];
        return (
          typeof key === "string" &&
          ["projects", "project", "sources", "source"].includes(key)
        );
      },
    },
  });
} else {
  throw new Error("Could not find root element");
}
