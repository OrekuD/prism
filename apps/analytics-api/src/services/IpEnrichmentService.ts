import type { IpInfoResponse } from "@prism/types";
import { logger } from "../utils/logger.js";

export type IpEnrichment = {
  country_code: string | null;
  lat: string | null;
  long: string | null;
};

const EMPTY: IpEnrichment = { country_code: null, lat: null, long: null };

const ENRICHMENT_TIMEOUT_MS = 2000;

/**
 * Best-effort IP geolocation for analytics sessions.
 *
 * IP enrichment must never block or break session ingestion: a missing token,
 * network failure, timeout, non-2xx response, malformed JSON, or a response
 * without `loc` all degrade to null geo fields instead of failing the request.
 */
export class IpEnrichmentService {
  public static async enrich(clientIp: string | null): Promise<IpEnrichment> {
    const token = process.env.IP_INFO_API_TOKEN;

    if (!token || !clientIp) {
      return EMPTY;
    }

    // Local development addresses have no meaningful geo data.
    if (
      clientIp === "127.0.0.1" ||
      clientIp === "::1" ||
      clientIp === "::ffff:127.0.0.1" ||
      clientIp === "localhost"
    ) {
      return EMPTY;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ENRICHMENT_TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://ipinfo.io/${clientIp}/json?token=${token}`,
        { signal: controller.signal },
      );

      if (!response.ok) {
        IpEnrichmentService.warn("non-2xx response");
        return EMPTY;
      }

      const data = (await response.json()) as Partial<IpInfoResponse>;

      if (typeof data.loc !== "string") {
        IpEnrichmentService.warn("response without loc");
        return EMPTY;
      }

      const [lat, long] = data.loc.split(",");
      if (!lat || !long) {
        IpEnrichmentService.warn("malformed loc");
        return EMPTY;
      }

      return {
        country_code: data.country ?? null,
        lat,
        long,
      };
    } catch (error) {
      // Timeouts and network errors must not drop the session.
      IpEnrichmentService.warn(
        error instanceof Error ? error.message : "unknown error",
      );
      return EMPTY;
    } finally {
      clearTimeout(timeout);
    }
  }

  private static warn(reason: string) {
    // Concise server-side warning only: never log the client IP or the token.
    logger.warn("analytics", "IP enrichment skipped", { reason });
  }
}
