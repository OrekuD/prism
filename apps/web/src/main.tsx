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
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { LocalStorageKeys } from "./constants/LocalStorageKeys";
import { PrismProvider } from "@prism/react";
import { PrismClient } from "@prism/core";

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

const prism = new PrismClient("key");

const el = document.getElementById("root");
if (el) {
  const root = createRoot(el);
  root.render(
    <React.StrictMode>
      <ThemeProvider
        defaultTheme="light"
        storageKey={LocalStorageKeys.THEME_VALUE}
      >
        <PrismProvider client={prism}>
          <QueryClientProvider client={client}>
            <App />
            <Toaster />
          </QueryClientProvider>
        </PrismProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
} else {
  throw new Error("Could not find root element");
}
