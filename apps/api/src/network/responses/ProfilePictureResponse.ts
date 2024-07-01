import { ProfilePictureResource } from "@prism/types";

export default class ProfilePictureResponse {
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
