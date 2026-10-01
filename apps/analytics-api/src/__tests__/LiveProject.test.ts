import "./testEnv.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	DurableObject: class {
		ctx: unknown;
		env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));
vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn() }));
vi.mock("../services/JwtVerifier.js", () => ({
	JwtVerifier: { verify: vi.fn() },
}));

import { neon } from "@neondatabase/serverless";
import { JwtVerifier } from "../services/JwtVerifier.js";
import { LiveProject } from "../worker/LiveProject.js";

const PROJECT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function socket(attachment: unknown = null) {
	let saved = attachment;
	return {
		get saved() {
			return saved;
		},
		serializeAttachment(value: unknown) {
			saved = value;
		},
		deserializeAttachment: () => saved,
		send: vi.fn(),
		close: vi.fn(),
	};
}

function room(sockets: ReturnType<typeof socket>[]) {
	return new LiveProject(
		{
			id: { name: PROJECT_ID },
			getWebSockets: () => sockets,
		} as never,
		{
			AUTH_BASE_URL: "https://api.example.test",
			DATABASE_URL: "postgres://example",
		},
	);
}

describe("LiveProject", () => {
	beforeEach(() => vi.clearAllMocks());

	it("only broadcasts to a verified, unexpired project subscriber", () => {
		const valid = socket({ projectId: PROJECT_ID, userId: "u1", expiresAt: Date.now() + 60_000 });
		const otherProject = socket({ projectId: "other", userId: "u2", expiresAt: Date.now() + 60_000 });
		const expired = socket({ projectId: PROJECT_ID, userId: "u3", expiresAt: Date.now() - 1 });
		const unauthenticated = socket();
		room([valid, otherProject, expired, unauthenticated]).broadcast("session-started");

		expect(valid.send).toHaveBeenCalledExactlyOnceWith("session-started");
		expect(otherProject.send).not.toHaveBeenCalled();
		expect(expired.send).not.toHaveBeenCalled();
		expect(expired.close).toHaveBeenCalledWith(1008, "Subscription expired");
		expect(unauthenticated.send).not.toHaveBeenCalled();
	});

	it("requires a signed token and current project membership before subscribing", async () => {
		const ws = socket();
		const live = room([ws]);
		vi.mocked(JwtVerifier.verify).mockResolvedValue({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 });
		const query = vi.fn().mockResolvedValue([]);
		vi.mocked(neon).mockReturnValue(query as never);

		await live.webSocketMessage(ws as never, JSON.stringify({
			type: "connect-project",
			data: { projectId: PROJECT_ID, token: "signed" },
		}));
		expect(ws.saved).toBeNull();
		expect(ws.close).toHaveBeenCalledWith(1008, "Unauthorized");

		query.mockResolvedValue([{ id: "u1" }]);
		const authorized = socket();
		await live.webSocketMessage(authorized as never, JSON.stringify({
			type: "connect-project",
			data: { projectId: PROJECT_ID, token: "signed" },
		}));
		expect(authorized.saved).toMatchObject({ projectId: PROJECT_ID, userId: "u1" });
	});
});
