import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
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
import { PrismClientV1 } from "@prism/core";

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

const prism = new PrismClientV1("pr_fa1b798ee9a540ad8e7eda40d43b321b");

const el = document.getElementById("root");
if (el) {
  const root = createRoot(el);
  root.render(
    <ThemeProvider
      defaultTheme="dark"
      storageKey={LocalStorageKeys.THEME_VALUE}
    >
      <PrismProvider client={prism}>
        <QueryClientProvider client={client}>
          <App />
          <Toaster />
        </QueryClientProvider>
      </PrismProvider>
    </ThemeProvider>,
  );
} else {
  throw new Error("Could not find root element");
}
