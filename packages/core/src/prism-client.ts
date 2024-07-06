import { AppEvent } from "./types";

export class PrismClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  public logEvent(event: AppEvent) {
    console.log({ event, key: this.apiKey });
  }

  public logCustomEvent(event: string) {
    console.log({ event, key: this.apiKey });
  }
}
