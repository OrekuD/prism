import React, { ReactNode } from "react";
import { PrismClient } from "@prism/core";
import { PrismProviderContext } from "./prism-context";

type PrismProviderProps = {
  children: ReactNode;
  client: PrismClient;
};

export class PrismProvider extends React.Component<PrismProviderProps> {
  componentDidMount(): void {
    function logPathname(): void {
      console.log("Current pathname:", window.location.pathname);
    }

    window.addEventListener("popstate", logPathname);

    const observer = new MutationObserver(logPathname);

    observer.observe(document.querySelector("body")!, {
      childList: true,
      subtree: true,
    });
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.log({
      error,
      errorInfo,
    });
  }

  render() {
    return (
      <PrismProviderContext.Provider value>
        {this.props.children}
      </PrismProviderContext.Provider>
    );
  }
}
