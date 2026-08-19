import type {
	ErrorIssueDelta,
	ErrorIssueLevel,
	ErrorIssuePlatform,
	ErrorIssueRange,
	ErrorIssueResource,
	ErrorIssueStatus,
} from "@prism-analytics/types";

/**
 * Error tracking vocabulary (task-15 UI slice).
 *
 * The typed contract — `ErrorIssueResource`, its unions, and the range
 * selector — lives in `@prism-analytics/types` (shared with the product
 * read/workflow API) so the page and the backend cannot drift. This module
 * keeps the presentation vocabulary: status/level/platform labels and the
 * canonical status tab order. `void`-free; re-exports are used at call
 * sites via type imports.
 */

export type {
	ErrorIssueRange,
	ErrorIssueDelta,
	ErrorIssueLevel,
	ErrorIssuePlatform,
	ErrorIssueResource,
	ErrorIssueStatus,
} from "@prism-analytics/types";

export const ERROR_STATUS_ORDER: readonly ErrorIssueStatus[] = [
	"unresolved",
	"resolved",
	"ignored",
];

export const STATUS_LABELS: Record<ErrorIssueStatus, string> = {
	unresolved: "Unresolved",
	resolved: "Resolved",
	ignored: "Ignored",
};

export const LEVEL_LABELS: Record<ErrorIssueLevel, string> = {
	error: "Error",
	warning: "Warning",
};

export const ERROR_PLATFORM_LABELS: Record<ErrorIssuePlatform, string> = {
	web: "Web",
	ios: "iOS",
	android: "Android",
	"react-native": "React Native",
	server: "Server",
};
