import React from "react";
import { PrismProviderContext } from "./prism-context";

export function usePrism() {
  const context = React.useContext(PrismProviderContext);

  if (!context) {
    throw new Error(`"usePrism" must be used within a PrismProvider`);
  }

  const { client } = context;

  return {
    logEvent: client.logEvent.bind(client),
    logCustomEvent: client.logCustomEvent.bind(client),
  };
}
