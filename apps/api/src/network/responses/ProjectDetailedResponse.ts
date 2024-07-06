import {
  ProjectDetailedResource,
  ProjectResource,
  TeamResource,
} from "@prism/types";
import { Project } from "../../models/Project";

export class ProjectDetailedResponse {
  private project: Project;

  constructor(project: Project) {
    this.project = project;
  }

  toJSON(): ProjectDetailedResource {
    return {
      id: this.project.id,
      name: this.project.name,
      slug: this.project.slug,
      apiKey: this.project.api_key,
      teamId: this.project.team_id,
    };
  }
}
