import type { OkResource } from "@prism-analytics/types";

export class OkResponse {
  private message: string;

  constructor(message?: string) {
    this.message = message || "success";
  }

  toJSON(): OkResource {
    return {
      message: this.message,
    };
  }
}
