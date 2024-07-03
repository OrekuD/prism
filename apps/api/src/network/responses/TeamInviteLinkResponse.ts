import { TeamInviteLinkResource } from "@prism/types";

export default class TeamInviteLinkResponse {
  private teamInviteUrl: string;

  constructor(teamInviteUrl: string) {
    this.teamInviteUrl = teamInviteUrl;
  }

  toJSON(): TeamInviteLinkResource {
    return {
      teamInviteUrl: this.teamInviteUrl,
    };
  }
}
