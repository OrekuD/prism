import { SessionResource } from "./network";

export type JWTPayload = {
  token: string;
  expiryAt: number;
  userId: string;
};

export type UserJWTPayload = {
  expiryAt: number;
  userId: string;
};

export type ImageKitIOExtensionStatus = "success" | "pending" | "failed";

export type ImageKitIOResource = {
  fileId: string;
  name: string;
  url: string;
  thumbnailUrl: string;
  height: number;
  width: number;
  size: number;
  filePath: string;
  tags: Array<string>;
  versionInfo: {
    id: string;
    name: string;
  };
  isPrivateFile: boolean;
  customCoordinates: null;
  customMetadata: { [key: string]: string };
  embeddedMetadata: { [key: string]: string };
  extensionStatus: {
    "google-auto-tagging": ImageKitIOExtensionStatus;
    "aws-auto-tagging": ImageKitIOExtensionStatus;
  };
  fileType: string;
  AITags: Array<{ name: string; confidence: number; source: string }>;
};

export type SocketConnectProject = {
  type: "connect-project";
  data: {
    projectId: string;
    /** Signed access-token JWT issued by the main API. Identity is derived from this token, never from client-supplied fields. */
    token: string;
  };
};

export type SocketSessionStarted = {
  type: "session-started";
  data: {
    session: SessionResource;
  };
};

export type SocketMessageTypes = SocketConnectProject | SocketSessionStarted;



export type IpAPIResponse = {
  ip: string;
  version: string;
  city: string;
  region: string;
  region_code: string;
  country_code: string;
  country_code_iso3: string;
  country_name: string;
  country_capital: string;
  country_tld: string;
  continent_code: string;
  in_eu: boolean;
  postal: string;
  latitude: number;
  longitude: number;
  timezone: string;
  utc_offset: string;
  country_calling_code: string;
  currency: string;
  currency_name: string;
  languages: string;
  country_area: number;
  country_population: number;
  asn: string;
  org: string;
  hostname: string;
};
