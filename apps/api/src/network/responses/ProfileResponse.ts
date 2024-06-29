import { ProfileResource } from "@prism/types";
import Profile from "../../models/Profile";

export default class ProfileResponse {
  private profile: Profile;

  constructor(profile: Profile) {
    this.profile = profile;
  }

  toJSON(): ProfileResource {
    return {
      firstName: this.profile.first_name,
      lastName: this.profile.last_name,
      gender: this.profile.gender,
      profilePicture: null,
      emailVerifiedAt: this.profile.email_verified_at
        ? new Date(this.profile.email_verified_at).toISOString()
        : null,
    };
  }
}
