import { TeamInviteResource } from "@prism/types";
import Team from "../../models/Team";

export default class TeamInviteResponse {
  private team: Team;

  constructor(team: Team) {
    this.team = team;
  }

  toJSON(): TeamInviteResource {
    return {
      name: this.team.name,
      avatarUrl: this.team.avatar_url,
    };
  }
}
