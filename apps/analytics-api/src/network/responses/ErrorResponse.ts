import { ErrorResource } from "@prism/types";

export class ErrorResponse {
  private errors: Array<string>;

  constructor(errors: string | Array<string>) {
    this.errors = typeof errors === "string" ? [errors] : errors;
  }

  toJSON(): ErrorResource {
    return {
      errors: this.errors,
    };
  }
}
