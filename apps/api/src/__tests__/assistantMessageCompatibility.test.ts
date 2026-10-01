import { describe, expect, it, vi } from "vitest";
import { AssistantMessageSchema } from "@prism-analytics/types";
import { getConversation, type AssistantDb } from "../utils/assistantStore";

const scope = { projectId: "proj_test", userId: "user_test", conversationId: "conv_test" };
const conversation = {
  id: scope.conversationId, slug: "chat_abc123def456", organization_id: "org_test",
  project_id: scope.projectId, user_id: scope.userId, title: "Saved chat",
  seed_insight_id: null, created_at: 100, updated_at: 200, last_message_at: 200,
};
const answer = { summary: "No measured change.", observations: [], primaryArtifactId: null, supportingArtifactIds: [], assumptions: [], followUps: [] as unknown[] };
function row(parts: unknown) {
  return { id: "msg_test", conversation_id: scope.conversationId, seq: 1, role: "assistant", status: "complete", parts, failure_code: null, client_request_id: null, created_at: 200, completed_at: 200 };
}
function database(message: ReturnType<typeof row>) {
  return vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("assistant_conversations")) return [conversation];
    if (sql.includes("assistant_messages")) return [message];
    return [];
  }) as unknown as AssistantDb;
}

describe("stored follow-up compatibility", () => {
  it("reads legacy string follow-ups without changing the stored answer or full question", async () => {
    const question = "Which pages had the most errors during the previous seven days?";
    const message = row([{ type: "text", text: answer.summary }, { type: "answer", answer: { ...answer, followUps: [question] } }]);
    const original = JSON.stringify(message);
    const detail = await getConversation(database(message), scope);
    expect(detail?.messages[0].parts[1]).toEqual({ type: "answer", answer: { ...answer, followUps: [{ title: "Which pages had", description: question }] } });
    expect(AssistantMessageSchema.safeParse(detail?.messages[0]).success).toBe(true);
    expect(JSON.stringify(message)).toBe(original);
  });

  it("keeps current object follow-ups unchanged", async () => {
    const parts = [{ type: "answer", answer: { ...answer, followUps: [{ title: "Check errors", description: "Check errors for this period." }] } }];
    const detail = await getConversation(database(row(parts)), scope);
    expect(detail?.messages[0].parts).toEqual(parts);
  });

  it.each([42, "x".repeat(201), { title: "Bad", description: 42 }])("does not mask unrelated malformed follow-ups (%j)", async (followUp) => {
    await expect(getConversation(database(row([{ type: "answer", answer: { ...answer, followUps: [followUp] } }])), scope)).rejects.toMatchObject({ code: "invalid-output" });
  });

  it("keeps unknown answer fields rejected", async () => {
    await expect(getConversation(database(row([{ type: "answer", answer: { ...answer, extra: true, followUps: ["Check errors"] } }])), scope)).rejects.toMatchObject({ code: "invalid-output" });
  });
});
