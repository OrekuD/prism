import { Roles } from "../types";

export type Auth = {
  accessToken: string;
  refreshToken: string;
  expiryAt: number;
  refreshExpiryAt: number;
  user: User;
};

export type Error = {
  errors: Array<string>;
};

export type Ok = {
  message: string;
};

export type ProfilePicture = {
  profilePicture: string;
};

export type Profile = {
  id: string;
  firstName: string;
  lastName: string;
  gender: string | null;
  email_verified_at: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type Team = {
  id: string;
  name: string;
  logo: string;
  coverPhoto: string | null;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  email: string;
  userName: string | null;
  role: Roles;
  createdAt: string | null;
  updatedAt: string | null;
  profile: Profile | null;
};
