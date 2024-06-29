import { UpdateUsernameResource } from "@prism/types";

export default class UpdateUsernameResponse {
  private username: string;

  constructor(username: string) {
    this.username = username;
  }

  toJSON(): UpdateUsernameResource {
    return {
      username: this.username,
    };
  }
}
