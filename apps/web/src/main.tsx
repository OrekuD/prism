import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
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

const client = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!query.meta?.error) return;
      toast.error(query.meta.error as string);
    },
  }),
  defaultOptions: {
    queries: {
      retry: import.meta.env.DEV ? 20 : 2,
    },
  },
});

const el = document.getElementById("root");
if (el) {
  const root = createRoot(el);
  root.render(
    <React.StrictMode>
      <ThemeProvider
        defaultTheme="light"
        storageKey={LocalStorageKeys.THEME_VALUE}
      >
        <QueryClientProvider client={client}>
          <App />
          <Toaster />
        </QueryClientProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
} else {
  throw new Error("Could not find root element");
}
