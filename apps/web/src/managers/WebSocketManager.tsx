import { useActiveSessionsStore } from "@/store/activeSessionsStore";
import { WS_BASE_URL } from "@/lib/api";
import { authClient, getServiceToken } from "@/lib/authClient";
import type { SocketConnectProject, SocketMessageTypes } from "@prism-analytics/types";
import React from "react";

type Props = {
  projectId?: string;
};

export function WebSocketManager(props: React.PropsWithChildren<Props>) {
  const addSession = useActiveSessionsStore((store) => store.addSession);
  const clearProject = useActiveSessionsStore((store) => store.clearProject);
  const { data: sessionData } = authClient.useSession();
  const projectId = props.projectId;

  React.useEffect(() => {
    if (!projectId || !sessionData?.session) return;

    let ws: WebSocket | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    // Request a short-lived service JWT for the analytics WebSocket. The
    // cookie session stays the primary credential; the JWT is only for the
    // analytics service (issuer/audience-bound, ~15m expiry).
    const retry = () => {
      if (cancelled) return;
      retryTimer = setTimeout(
        connect,
        Math.min(1_000 * 2 ** retryCount++, 30_000),
      );
    };

    const connect = async () => {
      let token: string | null;
      try {
        token = await getServiceToken();
      } catch {
        retry();
        return;
      }
      if (cancelled) return;
      if (!token) {
        retry();
        return;
      }

      const socket = new WebSocket(
        `${WS_BASE_URL}/ws?projectId=${encodeURIComponent(projectId)}`,
        ["prism", `prism.jwt.${token}`],
      );
      ws = socket;
      socket.onopen = () => {
        retryCount = 0;
        if (cancelled) {
          socket.close();
          return;
        }
        // Service JWTs last about 15 minutes; renew before the DO stops delivery.
        renewTimer = setTimeout(() => socket.close(), 12 * 60_000);
        const message: SocketConnectProject = {
          type: "connect-project",
          data: {
            projectId,
            token,
          },
        };
        socket.send(JSON.stringify(message));
      };

      socket.onerror = () => {
        console.log("Could not establish a WebSocket connection");
      };

      socket.onmessage = (event) => {
        let message: SocketMessageTypes;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (message.type) {
          case "session-started":
            addSession(projectId, message.data.session);
            break;
        }
      };

      socket.onclose = (event) => {
        if (renewTimer) clearTimeout(renewTimer);
        if (ws === socket) ws = null;
        if (event.code === 1008 && event.reason !== "Subscription expired")
          return;
        retry();
      };
    };

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (renewTimer) clearTimeout(renewTimer);
      ws?.close();
      // the project's live list is cleared when the subscription ends —
      // navigating away never leaves the previous project's sessions
      if (projectId) clearProject(projectId);
    };
  }, [projectId, sessionData?.session, addSession, clearProject]);

  return <>{props.children}</>;
}
