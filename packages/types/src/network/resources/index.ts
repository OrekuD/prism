import { Roles } from "../../enums";

export type ErrorResource = {
  errors: Array<string>;
};

export type OkResource = {
  message: string;
};

export type ProfilePictureResource = {
  profilePictureUrl: string;
};

export type TeamInviteLinkResource = {
  teamInviteUrl: string;
};



export type ProfileResource = {
  firstName: string;
  lastName: string;
  gender: string | null;
  profilePictureUrl: string | null;
  emailVerifiedAt: string | null;
};

export type TeamResource = {
  id: string;
  name: string;
  avatarUrl: string;
  ownerId: string;
  isPersonal: boolean;
};

export type TeamInviteResource = {
  id: string;
  name: string;
  avatarUrl: string;
};

export type UserResource = {
  id: string;
  email: string;
  userName: string | null;
  role: Roles;
  profile: ProfileResource | null;
};

export type ProjectResource = {
  id: string;
  name: string;
  slug: string;
  summary: Array<{ date: string; desktop: number; mobile: number }>;
};

/**
 * v2 session resource (task-9 slice 6): client-generated IDs, camelCase,
 * decoded context JSON. Raw IP and approximate coordinates are NOT part
 * of the model — a null-geo session still renders as a useful list row.
 */
export type SessionResource = {
  sessionId: string;
  projectId: string;
  anonymousId: string | null;
  startedAt: number;
  endedAt: number | null;
  lastSeenAt: number;
  context: Record<string, unknown> | null;
  isOnline: 0 | 1;
};

/**
 * v2 event resource: properties are DECODED at the API boundary into a
 * typed JSON value (never a JSON string the dashboard prints verbatim).
 */
export type EventResource = {
  id: string;
  sessionId: string | null;
  projectId: string;
  name: string;
  properties: Record<string, unknown> | null;
  occurredAt: number;
  receivedAt: number;
  schemaVersion: number;
};

export type ProjectDetailedResource = {
  id: string;
  name: string;
  slug: string;
  apiKey: string | null;
  teamId: string;
  analytics: {
    /** Per-day session counts over the requested duration (bounded aggregate). */
    summary: Array<{ date: string; desktop: number; mobile: number }>;
    device: {
      desktop: number;
      mobile: number;
    };
  };
};
