import User from "../../models/User";
import { UserResource } from "@prism/types";
import ProfileResponse from "./ProfileResponse";

export default class UserResponse {
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
      createdAt: this.user.created_at
        ? new Date(this.user.created_at).toISOString()
        : null,
      updatedAt: this.user.updated_at
        ? new Date(this.user.updated_at).toISOString()
        : null,
      profile: this.user.profile
        ? new ProfileResponse(this.user.profile).toJSON()
        : null,
    };
  }
}
