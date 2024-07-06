import { Roles } from "../../enums";

export type AuthResource = {
  accessToken: string;
  refreshToken: string;
  expiryAt: number;
  refreshExpiryAt: number;
  user: UserResource;
};

export type ErrorResource = {
  errors: Array<string>;
};

export type OkResource = {
  message: string;
};

export type ChangeEmailResource = {
  email: string;
};

export type UpdateUsernameResource = {
  username: string;
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
};

export type ProjectDetailedResource = {
  id: string;
  name: string;
  slug: string;
  apiKey: string | null;
  teamId: string;
};
