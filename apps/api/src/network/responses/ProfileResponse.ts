import { ProfileResource } from "@prism/types";
import Profile from "../../models/Profile";

export default class ProfileResponse {
  private profile: Profile;

  constructor(profile: Profile) {
    this.profile = profile;
  }

  toJSON(): ProfileResource {
    return {
      id: this.profile.id,
      firstName: this.profile.first_name,
      lastName: this.profile.last_name,
      gender: this.profile.gender,
      profilePicture: null,
      emailVerifiedAt: this.profile.email_verified_at
        ? new Date(this.profile.email_verified_at).toISOString()
        : null,
      createdAt: this.profile.created_at
        ? new Date(this.profile.created_at).toISOString()
        : null,
      updatedAt: this.profile.updated_at
        ? new Date(this.profile.updated_at).toISOString()
        : null,
    };
  }
}
