import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import "./dashboard-v2.css";
import { App } from "./App";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
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
} else {
  throw new Error("Could not find root element");
}
