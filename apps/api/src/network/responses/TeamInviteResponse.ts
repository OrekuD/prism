import type { TeamInviteResource } from "@prism/types";
import type { Team } from "../../models/Team";

export class TeamInviteResponse {
  private team: Team;

  constructor(team: Team) {
    this.team = team;
  }

  toJSON(): TeamInviteResource {
    return {
      id: this.team.id,
      name: this.team.name,
      avatarUrl: this.team.avatar_url,
    };
  }
}
