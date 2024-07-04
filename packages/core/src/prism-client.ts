export class PrismClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // private test() {
  //   function logPathname(): void {
  //     console.log("Current pathname:", window.location.pathname);
  //   }

  //   window.addEventListener("popstate", logPathname);

  //   const observer = new MutationObserver(logPathname);

  //   observer.observe(document.querySelector("body")!, {
  //     childList: true,
  //     subtree: true,
  //   });
  // }
}
