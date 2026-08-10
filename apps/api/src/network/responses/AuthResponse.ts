import type { User } from "../../models/User";
import { UserResponse } from "./UserResponse";
import type { AuthResource } from "@prism/types";

export class AuthResponse {
  private user: User;
  private accessToken: string;
  private refreshToken: string;
  private expiryAt: Date;
  private refreshExpiryAt: Date;

  constructor(
    accessToken: string,
    refreshToken: string,
    user: User,
    expiryAt: Date,
    refreshExpiryAt: Date,
  ) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.user = user;
    this.expiryAt = expiryAt;
    this.refreshExpiryAt = refreshExpiryAt;
  }

  toJSON(): AuthResource {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiryAt: this.expiryAt.getTime(),
      refreshExpiryAt: this.refreshExpiryAt.getTime(),
      user: new UserResponse(this.user).toJSON(),
    };
  }
}
