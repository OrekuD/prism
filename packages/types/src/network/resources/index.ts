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

export type ProfilePictureResource = {
  profilePicture: string;
};

export type ProfileResource = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string | null;
  email_verified_at: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TeamResource = {
  id: string;
  name: string;
  logo: string;
  coverPhoto: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserResource = {
  id: string;
  email: string;
  userName: string | null;
  role: Roles;
  createdAt: string | null;
  updatedAt: string | null;
  profile: ProfileResource | null;
};
