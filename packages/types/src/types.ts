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
    accessToken: string;
  };
};

export type SocketResetProject = {
  type: "reset-project";
  data: {
    // projectId: string;
  };
};

export type SocketMessageTypes = SocketConnectProject | SocketResetProject;

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
