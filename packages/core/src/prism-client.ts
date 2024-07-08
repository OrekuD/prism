import { AppEvent } from "./types";
import { AddNewSessionDataRequest } from "@prism/types";

export class PrismClient {
  private readonly apiKey: string;
  private apiUrl: string = "http://localhost:8787/api/v1/analytics";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("Prism Api key not provided");
    }
    this.apiKey = apiKey;
    this.logSession();
  }

  public logEvent(event: AppEvent) {
    console.log({ event, key: this.apiKey });
  }

  public logCustomEvent(event: string) {
    console.log({ event, key: this.apiKey });
  }
  private async logSession() {
    const countryCode = (await this.getLocation()) || "";
    const body: AddNewSessionDataRequest = {
      userAgent: navigator.userAgent,
      countryCode,
      referrer: document.referrer,
      location: window.location.pathname,
    };

    this.sendPostRequest("/sessions", body);
  }

  private sendPostRequest(url: string, data: any) {
    if (!url) return;
    const apiUrl = this.apiUrl + url;

    fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(data),
    })
      .then((res) => {
        if (!res.ok) {
          console.log("error");
        } else {
          console.log("saved");
        }
      })
      .catch((error) => console.log({ error }));
  }

  private async getLocation() {
    try {
      const response = await (await fetch("https://ip-api.com/json")).json();

      return response.countryCode as string;
    } catch (error) {}
  }
}
