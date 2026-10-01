import { z } from "zod";
import {
  ANSWER_LIMITS,
  AssistantAnswerSchema,
  AssistantFollowUpSchema,
} from "@prism-analytics/types";

// Read-only compatibility for answers saved before follow-up pills gained
// separate titles/descriptions. Keep the full question; shorten only its label.
// Current writes and all unrelated answer/artifact validation stay strict.
const StoredAnswerPartSchema = z.strictObject({
  type: z.literal("answer"),
  answer: AssistantAnswerSchema.extend({
    followUps: z.array(z.union([
      AssistantFollowUpSchema,
      AssistantFollowUpSchema.shape.description.transform((description) => ({
        title: description.trim().split(/\s+/)
          .slice(0, ANSWER_LIMITS.maxFollowUpTitleWords).join(" ")
          .slice(0, ANSWER_LIMITS.maxFollowUpTitleChars) || "Follow up",
        description,
      })).pipe(AssistantFollowUpSchema),
    ])).max(ANSWER_LIMITS.maxFollowUps),
  }),
});

export function normalizeStoredMessageParts(parts: unknown): unknown {
  if (!Array.isArray(parts)) return parts;
  return parts.map((part) => {
    const parsed = StoredAnswerPartSchema.safeParse(part);
    // Do not hide malformed content: the caller's complete message schema
    // still rejects anything outside this exact legacy representation.
    return parsed.success ? parsed.data : part;
  });
}
