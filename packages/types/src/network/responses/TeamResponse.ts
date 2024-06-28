import Team from "../../models/Team";

export type TeamResource = {
  id: string;
  name: string;
  logo: string;
  coverPhoto: string | null;
  createdAt: string;
  updatedAt: string;
};

export default class TeamResponse {
  private team: Team;
  private logo: string;

  constructor(team: Team, logo?: string) {
    this.team = team;
    this.logo = logo || "";
  }

  toJSON(): TeamResource {
    return {
      id: this.team.id,
      name: this.team.name,
      logo: this.logo,
      coverPhoto: null,
      createdAt: new Date(this.team.created_at).toISOString(),
      updatedAt: new Date(this.team.updated_at).toISOString(),
    };
  }
}
