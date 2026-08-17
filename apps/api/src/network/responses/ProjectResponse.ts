import type { ProjectResource } from "@prism-analytics/types";
import type { Project } from "../../models/Project";

export class ProjectResponse {
  private project: Project;
  private summary: ProjectResource["summary"];

  constructor(project: Project, summary: ProjectResource["summary"]) {
    this.project = project;
    this.summary = summary;
  }

  toJSON(): ProjectResource {
    return {
      id: this.project.id,
      name: this.project.name,
      slug: this.project.slug,
      summary: this.summary,
    };
  }
}
