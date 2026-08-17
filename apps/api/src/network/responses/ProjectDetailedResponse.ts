import type { ProjectDetailedResource } from "@prism/types";
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
      organizationId: this.project.organization_id,
      analytics: this.analytics,
    };
  }
}
