import {
  type ProjectDetailedResource,
  ProjectResource,
  TeamResource,
} from "@prism/types";
import type { Project } from "../../models/Project";

export class ProjectDetailedResponse {
  private project: Project;
  private analytics: ProjectDetailedResource["analytics"];

  constructor(
    project: Project,
    analytics: ProjectDetailedResource["analytics"],
  ) {
    this.project = project;
    this.analytics = analytics;
  }

  toJSON(): ProjectDetailedResource {
    return {
      id: this.project.id,
      name: this.project.name,
      slug: this.project.slug,
      apiKey: this.project.api_key,
      teamId: this.project.team_id,
      analytics: this.analytics,
    };
  }
}
