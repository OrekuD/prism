import React, { ReactNode } from "react";
import { PrismClient } from "@prism/core";
import { PrismProviderContext } from "./prism-context";

type PrismProviderProps = {
  children: ReactNode;
  client: PrismClient;
};

export class PrismProvider extends React.Component<PrismProviderProps> {
  constructor(props: PrismProviderProps) {
    super(props);

    this.state = { hasError: false };
  }

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

  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // this.setState({
    //   hasError: true,
    //   error,
    //   errorInfo,
    // });
    console.log({
      ___error: error,
      ___errorInfo: errorInfo,
    });
  }

  componentWillUnmount(): void {
    // this.props.client.endSession();
  }

  render() {
    return (
      <PrismProviderContext.Provider
        value={{
          client: this.props.client,
        }}
      >
        {this.props.children}
      </PrismProviderContext.Provider>
    );
  }
}
