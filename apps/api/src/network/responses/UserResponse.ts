import type { PrismUser } from "../../models/User";
import type { Profile } from "../../models/Profile";
import type { UserResource } from "@prism-analytics/types";
import { ProfileResponse } from "./ProfileResponse";

export class UserResponse {
  private user: PrismUser;
  private profile: Profile | null;

  constructor(user: PrismUser, profile: Profile | null) {
    this.user = user;
    this.profile = profile;
  }

  toJSON(): UserResource {
    return {
      id: this.user.id,
      email: this.user.email,
      role: this.user.role ?? 1,
      userName: this.user.userName ?? null,
      profile: this.profile
        ? new ProfileResponse(this.profile).toJSON()
        : null,
    };
  }
}
