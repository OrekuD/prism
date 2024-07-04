import { ProfileResource } from "@prism/types";
import { Profile } from "../../models/Profile";

export class ProfileResponse {
  private profile: Profile;

  constructor(profile: Profile) {
    this.profile = profile;
  }

  toJSON(): ProfileResource {
    return {
      firstName: this.profile.first_name,
      lastName: this.profile.last_name,
      gender: this.profile.gender,
      profilePictureUrl: this.profile.profile_picture_url || null,
      emailVerifiedAt: this.profile.email_verified_at
        ? new Date(this.profile.email_verified_at).toISOString()
        : null,
    };
  }
}
