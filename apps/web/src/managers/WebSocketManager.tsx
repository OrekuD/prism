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

    // Request a short-lived service JWT for the analytics WebSocket. The
    // cookie session stays the primary credential; the JWT is only for the
    // analytics service (issuer/audience-bound, ~15m expiry).
    getServiceToken()
      .then((token) => {
        if (cancelled || !token) return;

        ws = new WebSocket(`${WS_BASE_URL}/ws`);

        ws.onopen = () => {
          const message: SocketConnectProject = {
            type: "connect-project",
            data: {
              projectId,
              token,
            },
          };
          ws?.send(JSON.stringify(message));
        };

        ws.onerror = () => {
          console.log("Could not establish a WebSocket connection");
        };

        ws.onmessage = (event) => {
          const message: SocketMessageTypes = JSON.parse(event.data);

          switch (message.type) {
            case "session-started":
              addSession(projectId, message.data.session);
              break;
          }
        };

        ws.onclose = () => {
          console.log("WebSocket connection closed");
        };
      })
      .catch(() => {
        console.log("Could not obtain a service token");
      });

    return () => {
      cancelled = true;
      ws?.close();
      // the project's live list is cleared when the subscription ends —
      // navigating away never leaves the previous project's sessions
      if (projectId) clearProject(projectId);
    };
  }, [projectId, sessionData?.session, addSession, clearProject]);

  return <>{props.children}</>;
}
