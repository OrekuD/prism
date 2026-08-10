import type { TeamResource } from "@prism/types";
import type { Team } from "../../models/Team";

export class TeamResponse {
  private team: Team;

  constructor(team: Team) {
    this.team = team;
  }

  toJSON(): TeamResource {
    return {
      id: this.team.id,
      name: this.team.name,
      isPersonal: this.team.is_personal,
      avatarUrl: this.team.avatar_url,
      ownerId: this.team.owner_id,
    };
  }
}
