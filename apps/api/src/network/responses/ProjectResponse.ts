import { ProjectResource, TeamResource } from "@prism/types";
import { Project } from "../../models/Project";

export class ProjectResponse {
  private project: Project;

  constructor(project: Project) {
    this.project = project;
  }

  toJSON(): ProjectResource {
    return {
      id: this.project.id,
      name: this.project.name,
      slug: this.project.slug,
    };
  }
}
