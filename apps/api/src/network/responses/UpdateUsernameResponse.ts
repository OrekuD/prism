import type { UpdateUsernameResource } from "@prism/types";

export class UpdateUsernameResponse {
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
