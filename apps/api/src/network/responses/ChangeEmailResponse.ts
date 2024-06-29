import { ChangeEmailResource } from "@prism/types";

export default class ChangeEmailResponse {
  private email: string;

  constructor(email: string) {
    this.email = email;
  }

  toJSON(): ChangeEmailResource {
    return {
      email: this.email,
    };
  }
}
