import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserClient } from "@prism-analytics/browser";
import { PrismProvider } from "@prism-analytics/react";
import type { PrismClient } from "@prism-analytics/core";
import { App } from "./App";
import "./styles.css";

const sourceKey = import.meta.env.VITE_PRISM_SOURCE_KEY as string | undefined;
const endpoint = import.meta.env.VITE_PRISM_INGEST_URL as string | undefined;
const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Task 14 fixture root is missing");
}
const mount = root;

async function bootstrap() {
  if (!sourceKey || !endpoint) {
    mount.innerHTML = `
      <main class="failure">
        <h1>Prism SDK initialization failed</h1>
        <p>Set VITE_PRISM_SOURCE_KEY and VITE_PRISM_INGEST_URL before starting the fixture.</p>
      </main>`;
    return;
  }

  let client: PrismClient;
  try {
    client = await createBrowserClient({
      sourceKey,
      endpoint,
      collection: { initialState: "denied", anonymousPersistence: "session" },
      queue: { maxBatchEvents: 20 },
    });
  } catch (error) {
    mount.innerHTML = `
      <main class="failure">
        <h1>Prism SDK initialization failed</h1>
        <p>${error instanceof Error ? error.message : "The client could not be created."}</p>
      </main>`;
    return;
  }

  const handle = () => {
    void client.shutdown({ timeoutMs: 1_000 });
  };
  window.addEventListener("pagehide", handle, { once: true });

  createRoot(mount).render(
    <React.StrictMode>
      <PrismProvider client={client}>
        <App />
      </PrismProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
