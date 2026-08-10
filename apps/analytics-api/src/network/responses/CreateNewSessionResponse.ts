import type { CreateNewSessionResource } from "@prism/types";

export class CreateNewSessionResponse {
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  toJSON(): CreateNewSessionResource {
    return {
      sessionId: this.sessionId,
    };
  }
}
