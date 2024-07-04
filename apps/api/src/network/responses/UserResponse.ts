import { User } from "../../models/User";
import { UserResource } from "@prism/types";
import { ProfileResponse } from "./ProfileResponse";

export class UserResponse {
  private user: User;

  constructor(user: User) {
    this.user = user;
  }

  toJSON(): UserResource {
    return {
      id: this.user.id,
      email: this.user.email,
      role: this.user.role,
      userName: this.user.user_name,
      profile: this.user.profile
        ? new ProfileResponse(this.user.profile).toJSON()
        : null,
    };
  }
}
