import { createRoot } from "react-dom/client";
import "./index.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";
import { LocalStorageKeys } from "./constants/LocalStorageKeys";
import { initTelemetry } from "./lib/prism";
import { client } from "./lib/queryClient";

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

	// F6/F7: persistence is user-scoped and handled in App.tsx via
	// QueryPersistor (needs the session). The query client itself lives in
	// lib/queryClient so tests can import it without booting the DOM.
} else {
	throw new Error("Could not find root element");
}
