import {
  StartSessionRequest,
  EndSessionRequest,
  LogEventRequest,
  CreateNewSessionResource,
} from "@prism/types";

export class PrismClient {
  private readonly apiKey: string;
  private sessionId: string = "";
  private apiUrl: string = process.env.API_URL + "/api/v1/analytics";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("Prism Api key not provided");
    }
    this.apiKey = apiKey;
    // Session bootstrap is best-effort analytics plumbing: it must never
    // produce an unhandled rejection that could take down the host app
    // (React 19 unmounts the root on uncaught effect errors).
    this.startSession().catch(() => undefined);
    this.trackError();
  }

  /**
   * Logs a named event with optional structured data for the current
   * session. Events are stored server-side and shown on the project's
   * Events dashboard.
   */
  public async logEvent(
    event: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.sessionId) return;
    const body: LogEventRequest = {
      sessionId: this.sessionId,
      name: event,
      ...(data === undefined ? {} : { data }),
    };
    await this.sendPostRequest("/events", body);
  }

  /** Alias of logEvent with a distinct name for custom product events. */
  public async logCustomEvent(
    name: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    await this.logEvent(name, data);
  }

  public async startSession() {
    const body: StartSessionRequest = {
      userAgent: navigator.userAgent,
      referrer: document.referrer,
      location: window.location.pathname,
    };

    const response = await this.sendPostRequest<CreateNewSessionResource>(
      "/sessions",
      body,
    );
    if (response?.sessionId) {
      this.sessionId = response.sessionId;
    }
  }

  /**
   * Ends the current session using a browser-safe delivery mechanism that
   * survives page close/navigation: fetch with `keepalive` when available
   * (it preserves the Authorization header), falling back to sendBeacon.
   */
  public endSession() {
    if (!this.sessionId) return;

    const body: EndSessionRequest = { sessionId: this.sessionId };
    const url = this.apiUrl + "/sessions/end";

    try {
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {
        // Best-effort: the session is also marked stale server-side.
      });
    } catch {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          url,
          new Blob([JSON.stringify(body)], { type: "application/json" }),
        );
      }
    }

    this.sessionId = "";
  }

  private sendPostRequest<T>(url: string, data: unknown): Promise<T> {
    if (!url) return Promise.resolve(undefined as T);
    const apiUrl = this.apiUrl + url;

    return fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
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
      .catch((error) => console.log({ error }));
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
