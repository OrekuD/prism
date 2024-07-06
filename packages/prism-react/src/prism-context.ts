import { PrismClient } from "@prism/core";
import React from "react";

type PrismProviderContextValue = {
  client: PrismClient;
};

export const PrismProviderContext =
  React.createContext<PrismProviderContextValue | null>(null);
