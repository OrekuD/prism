/**
 * Hosted onboarding state (design-system.md 12).
 * Progress persists in localStorage so a refresh resumes at the last
 * completed step; completion and skip both mark the flow done.
 */
import axios from "axios";
import { axiosInstance } from "@/utils/axiosInstance";
import type {
  EventResource,
  ProjectDetailedResource,
  ProjectResource,
} from "@prism/types";

const STORAGE_KEY = "prism.onboarding";

export type OnboardingProgress = {
  /** 1-based index of the first incomplete step. */
  step: number;
  projectId?: string;
  projectSlug?: string;
  apiKey?: string;
};

export function loadProgress(): OnboardingProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardingProgress;
    // The key is cleared when the flow advances to the install step; a
    // saved step 4 without a key means the flow already moved on.
    if (parsed.step === 4 && !parsed.apiKey) parsed.step = 5;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProgress(progress: OnboardingProgress): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function completeOnboarding(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: 7 }));
}

export function isOnboardingComplete(totalSteps = 6): boolean {
  // The terminal screen is the last step (6 hosted, 7 self-hosted).
  return (loadProgress()?.step ?? 0) >= totalSteps;
}

/**
 * Task 13: create the first project inside the current workspace
 * (POST /projects with the organizationId — membership is proven
 * server-side). Projects do not carry keys; sources do, so the first
 * source is created right after and its publishable key is what the SDK
 * step shows.
 */
export async function createFirstProject(
  organizationId: string,
  name: string,
): Promise<ProjectResource> {
  let response: import("axios").AxiosResponse<{ message: string }>;
  try {
    response = await axiosInstance.post<{ message: string }>("/projects", {
      organizationId,
      name,
    });
  } catch (err) {
    if (
      axios.isAxiosError(err) &&
      (err.response?.data?.errors as Array<string> | undefined)?.includes(
        "email_not_verified",
      )
    ) {
      throw new Error(
        "Verify your email to create projects — check your inbox for the confirmation link.",
      );
    }
    throw err;
  }
  if (response.status !== 200) {
    throw new Error("Could not create the project.");
  }
  const projects = await axiosInstance.get<Array<ProjectResource>>(
    `/projects?organizationId=${encodeURIComponent(organizationId)}`,
  );
  const project = projects.data.find((entry) => entry.name === name);
  if (!project) throw new Error("Project created but not found.");
  return project;
}

/** Creates the first WEB source for the project; its publishable key is
 * what the install snippet needs. */
export async function createFirstSource(
  slug: string,
  name: string,
): Promise<{ id: string; initialKey?: string }> {
  const response = await axiosInstance.post<{
    id: string;
    initialKey?: string;
  }>(`/projects/${slug}/sources`, {
    name,
    platform: "web",
    allowedOrigins: [window.location.origin],
  });
  return response.data;
}

/** GET /api/v1/projects/:slug — project details. */
export async function fetchProjectForOnboarding(
  slug: string,
): Promise<ProjectDetailedResource> {
  const response = await axiosInstance.get<ProjectDetailedResource>(
    `/projects/${slug}`,
  );
  return response.data;
}

/** GET /api/v1/projects/:slug/events — the first-event poll target. */
export async function fetchProjectEvents(
  slug: string,
): Promise<Array<EventResource>> {
  const response = await axiosInstance.get<Array<EventResource>>(
    `/projects/${slug}/events`,
  );
  return response.data;
}
