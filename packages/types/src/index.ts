export * from "./network";

export enum Roles {
  USER = 1,
  ADMIN = 2,
  SUPER_ADMIN = 3,
  BANNED = 100,
  SUSPENDED = -1,
}

export type User = {
  id: string;
  email: string;
  userName: string | null;
  role: Roles;
  createdAt: string | null;
  updatedAt: string | null;
};
