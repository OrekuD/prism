import { type ProjectResource, TeamResource } from "@prism/types";
import type { Project } from "../../models/Project";
import type { Session } from "../../models/Session";
import { groupSessionsByDateAndPlatform } from "../../utils/groupSessionsByDateAndPlatform";

export class ProjectResponse {
  private project: Project;
  private sessionData: Array<Session>;

  constructor(project: Project, sessionData: Array<Session>) {
    this.project = project;
    this.sessionData = sessionData;
  }

  toJSON(): ProjectResource {
    return {
      id: this.project.id,
      name: this.project.name,
      slug: this.project.slug,
      summary: groupSessionsByDateAndPlatform(this.sessionData, "seven-days"),
    };
  }
}
