import { PrismClientV1 } from "@prism/core";
import React from "react";

type PrismProviderContextValue = {
  client: PrismClientV1;
};

export const PrismProviderContext =
  React.createContext<PrismProviderContextValue | null>(null);
