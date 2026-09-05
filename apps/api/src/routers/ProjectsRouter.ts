import { Hono } from "hono";
import { AssistantController } from "../controllers/AssistantController";
import { ErrorIssuesController } from "../controllers/ErrorIssuesController";
import { PeopleController } from "../controllers/PeopleController";
import { ProjectsController } from "../controllers/ProjectsController";
import { SourcesController } from "../controllers/SourcesController";
import {
	AuthenticationMiddleware,
	RequireVerifiedEmailMiddleware,
} from "../middlewares/AuthenticationMiddleware";

const router = new Hono();

router.use(AuthenticationMiddleware);
// The list route must precede /:slug so "projects" is never parsed as a
// slug. Empty-path patterns ("" not "/") match the sub-router mount
// /projects exactly — Hono does not normalize the stripped path.
router.get("", ProjectsController.listProjects);
router.get("/:slug", ProjectsController.getProjectBySlug);
router.get("/:slug/mobile-analytics", ProjectsController.getMobileAnalytics);
router.get("/:slug/web-analytics", ProjectsController.getWebAnalytics);
router.get("/:slug/events", ProjectsController.getProjectEvents);
router.get("/:slug/metrics", ProjectsController.getMetrics);
router.get("/:slug/overview", ProjectsController.getOverview);
// Task 21 slice 6: authorized streaming assistant API (member-owned
// chats, snapshot-verified runs, typed memory confirm/reject).
router.get("/:slug/assistant/conversations", AssistantController.listConversations);
router.post("/:slug/assistant/conversations", AssistantController.createConversation);
router.get(
  "/:slug/assistant/conversations/:conversationId",
  AssistantController.getConversation,
);
router.delete(
  "/:slug/assistant/conversations/:conversationId",
  AssistantController.deleteConversation,
);
router.post(
  "/:slug/assistant/conversations/:conversationId/messages",
  AssistantController.postMessage,
);
router.get("/:slug/assistant/memory", AssistantController.getMemory);
router.post(
  "/:slug/assistant/memory/:proposalId/confirm",
  AssistantController.confirmProposal,
);
router.post(
  "/:slug/assistant/memory/:proposalId/reject",
  AssistantController.rejectProposal,
);
// Error tracking (task-15 slices 2 + 4): issue list + detail + workflow
// state. Detail summarizes sanitized occurrences and workflow history with
// no occurrence endpoint (occurrence ids are unguessable UUIDs, only ever
// reached through an authorized project+issue parent).
router.get("/:slug/errors", ErrorIssuesController.paginatedList);
router.get("/:slug/errors/:issueId", ErrorIssuesController.detail);
router.patch("/:slug/errors/:issueId", ErrorIssuesController.update);
// People + baseline query APIs (task-10 §5)
router.get("/:slug/people", PeopleController.list);
router.get("/:slug/people/:personId", PeopleController.detail);
router.get("/:slug/people/:personId/activity", PeopleController.activity);
router.get("/:slug/people/:personId/export", PeopleController.export);
router.delete("/:slug/people/:personId", PeopleController.remove);
router.get("/:slug/events/filtered", PeopleController.events);
router.get("/:slug/breakdown", PeopleController.breakdown);
router.get("/:slug/totals", PeopleController.totals);
// Task 13: source + source-key management (SDK setup and rotation live in
// source detail).
router.get("/:slug/sources", SourcesController.list);
router.post("/:slug/sources", SourcesController.create);
router.get("/:slug/sources/:sourceId", SourcesController.detail);
router.patch("/:slug/sources/:sourceId", SourcesController.update);
router.get(
	"/:slug/sources/:sourceId/error-settings",
	SourcesController.errorSettings,
);
router.patch(
	"/:slug/sources/:sourceId/error-settings",
	SourcesController.updateErrorSettings,
);
router.delete("/:slug/sources/:sourceId", SourcesController.remove);
router.post("/:slug/sources/:sourceId/keys", SourcesController.createKey);
router.post(
	"/:slug/sources/:sourceId/keys/:keyId/revoke",
	SourcesController.revokeKey,
);
router.post(
	"/:slug/sources/:sourceId/keys/:keyId/reveal",
	SourcesController.revealKey,
);
router.post(
	"/",
	RequireVerifiedEmailMiddleware,
	ProjectsController.createProject,
);
router.patch("/:projectId", ProjectsController.renameProject);
router.delete("/:projectId", ProjectsController.deleteProject);

export { router };
