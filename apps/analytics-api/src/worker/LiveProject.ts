/// <reference types="@cloudflare/workers-types" />
import { neon } from "@neondatabase/serverless";
import { DurableObject } from "cloudflare:workers";
import { JwtVerifier } from "../services/JwtVerifier.js";

interface LiveProjectEnv {
	AUTH_BASE_URL: string;
	DATABASE_URL: string;
}

interface Subscriber {
	projectId: string;
	userId: string;
	expiresAt: number;
}

const MAX_CONNECT_MESSAGE_BYTES = 16_384;

/** One hibernating Live room per project, addressed with getByName(projectId). */
export class LiveProject extends DurableObject<LiveProjectEnv> {
	async fetch(request: Request): Promise<Response> {
		const projectId = new URL(request.url).searchParams.get("projectId");
		if (
			request.method !== "GET" ||
			request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
			!projectId ||
			projectId !== this.ctx.id.name
		) {
			return new Response("Invalid WebSocket request", { status: 400 });
		}

		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		return new Response(null, { status: 101, webSocket: client,
			headers: { "Sec-WebSocket-Protocol": "prism" } });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		if (typeof raw !== "string" || raw.length > MAX_CONNECT_MESSAGE_BYTES) {
			ws.close(1008, "Invalid connection message");
			return;
		}

		let message: unknown;
		try {
			message = JSON.parse(raw);
		} catch {
			ws.close(1008, "Invalid connection message");
			return;
		}
		const data =
			message && typeof message === "object" && "data" in message
				? message.data
				: null;
		if (
			!message ||
			typeof message !== "object" ||
			!("type" in message) ||
			message.type !== "connect-project" ||
			!data ||
			typeof data !== "object" ||
			!("projectId" in data) ||
			typeof data.projectId !== "string" ||
			data.projectId !== this.ctx.id.name ||
			!("token" in data) ||
			typeof data.token !== "string" ||
			data.token.length === 0 ||
			data.token.length > 8192
		) {
			ws.close(1008, "Invalid connection message");
			return;
		}

		const authBaseUrl = this.env.AUTH_BASE_URL?.replace(/\/$/, "");
		if (!authBaseUrl || !this.env.DATABASE_URL) {
			ws.close(1011, "Live unavailable");
			return;
		}
		const verified = await JwtVerifier.verify(
			data.token,
			`${authBaseUrl}/api/auth/jwks`,
		);
		if (
			!verified?.sub ||
			typeof verified.exp !== "number" ||
			!Number.isInteger(verified.exp) ||
			verified.exp * 1000 <= Date.now()
		) {
			ws.close(1008, "Unauthorized");
			return;
		}

		try {
			const sql = neon(this.env.DATABASE_URL);
			const members = await sql`
				SELECT u.id
				FROM "user" u
				JOIN member m ON m.user_id = u.id
				JOIN projects p ON p.organization_id = m.organization_id
				WHERE u.id = ${verified.sub} AND p.id = ${data.projectId}
				LIMIT 1
			`;
			if (members.length === 0) {
				ws.close(1008, "Unauthorized");
				return;
			}
		} catch {
			ws.close(1011, "Live unavailable");
			return;
		}

		ws.serializeAttachment({
			projectId: data.projectId,
			userId: verified.sub,
			expiresAt: verified.exp * 1000,
		} satisfies Subscriber);
	}

	/** Called by the ingestion Worker after a session-started event is accepted. */
	broadcast(message: string): void {
		for (const ws of this.ctx.getWebSockets()) {
			const subscriber = ws.deserializeAttachment() as Subscriber | null;
			if (!subscriber || subscriber.projectId !== this.ctx.id.name) continue;
			if (subscriber.expiresAt <= Date.now()) {
				ws.close(1008, "Subscription expired");
				continue;
			}
			try {
				ws.send(message);
			} catch {
				ws.close(1011, "Live unavailable");
			}
		}
	}
}
