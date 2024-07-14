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

export type TeamInviteJWTPayload = {
  teamId: string;
  expiryAt: number;
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
    userId: string;
  };
};

export type SocketUserConnected = {
  type: "user-connected";
  data: {
    session: SessionResource;
  };
};

export type SocketMessageTypes = SocketConnectProject | SocketUserConnected;

export type IpInfoResponse = {
  ip: string;
  city: string;
  region: string;
  country: string;
  loc: string;
  org: string;
  timezone: string;
  readme: string;
};

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
