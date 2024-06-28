import { Profile } from "./Profile";
import { Roles } from "@prism/types";

export type User = {
  id: string;
  email: string;
  userName: string | null;
  role: Roles;
  createdAt: string | null;
  updatedAt: string | null;
  profile: Profile | null;
};
