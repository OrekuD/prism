import { ProfilePictureResource } from "@prism/types";

export class ProfilePictureResponse {
  private profilePicture: string;

  constructor(profilePicture: string) {
    this.profilePicture = profilePicture;
  }

  toJSON(): ProfilePictureResource {
    return {
      profilePictureUrl: this.profilePicture,
    };
  }
}
