import { AppEvent } from "./types";
import {
  StartSessionRequest,
  EndSessionRequest,
  CreateNewSessionResource,
} from "@prism/types";

export class PrismClient {
  private readonly apiKey: string;
  private sessionId: string = "";
  // private apiUrl: string = process.env.API_URL + "/api/v1/analytics";
  private apiUrl: string = "http://localhost:8080/api/v1/analytics";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("Prism Api key not provided");
    }
    this.apiKey = apiKey;
    this.startSession();
    this.trackError();
  }

  public logEvent(event: AppEvent) {
    console.log({ event, key: this.apiKey });
  }

  public logCustomEvent(event: string) {
    console.log({ event, key: this.apiKey });
  }

  public async startSession() {
    const body: StartSessionRequest = {
      userAgent: navigator.userAgent,
      referrer: document.referrer,
      location: window.location.pathname,
    };

    const response: CreateNewSessionResource = await this.sendPostRequest(
      "/sessions",
      body,
    );
    if (response.sessionId) {
      this.sessionId = response.sessionId;
    }
  }

  public async endSession() {
    const body: EndSessionRequest = {
      sessionId: this.sessionId,
    };

    await this.sendPostRequest("/sessions/end", body);
  }

  private sendPostRequest(url: string, data: any) {
    if (!url) return;
    const apiUrl = this.apiUrl + url;

    return fetch(apiUrl, {
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
        return res.json();
      })
      .then((data) => data)
      .catch((error) => console.log({ error }));
  }

  private async getLocation() {
    try {
      const response = await (await fetch("http://ip-api.com/json")).json();

      return response.countryCode as string;
    } catch (error) {}
  }

  private trackError() {
    window.addEventListener("error", (event) => {
      // console.log("____Global error:", typeof event.error);
      // console.log(event.error.stack);
    });

    window.addEventListener("unhandledrejection", (event) => {
      console.log("_____Unhandled promise rejection:", event.reason);
    });
  }
}
