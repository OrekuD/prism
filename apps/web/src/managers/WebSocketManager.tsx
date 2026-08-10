import { useActiveSessionsStore } from "@/store/activeSessionsStore";
import { useAuthenticationStore } from "@/store/authenticationStore";
import type { SocketConnectProject, SocketMessageTypes } from "@prism/types";
import React from "react";

type Props = {
  projectId?: string;
};

export function WebSocketManager(props: React.PropsWithChildren<Props>) {
  const addSession = useActiveSessionsStore((store) => store.addSession);
  const accessToken = useAuthenticationStore(
    (store) => store.authentication?.accessToken,
  );
  const projectId = props.projectId;

  React.useEffect(() => {
    if (!projectId || !accessToken) return;

    const ws = new WebSocket(`${import.meta.env.VITE_WS_API_URL}/ws`);

    ws.onopen = () => {
      const message: SocketConnectProject = {
        type: "connect-project",
        data: {
          projectId,
          // The signed access token is the only identity the server trusts.
          token: accessToken,
        },
      };
      ws.send(JSON.stringify(message));
    };

    ws.onerror = () => {
      console.log("Could not establish a WebSocket connection");
    };

    ws.onmessage = (event) => {
      const message: SocketMessageTypes = JSON.parse(event.data);

      switch (message.type) {
        case "user-connected":
          addSession(message.data.session);
          break;
      }
    };

    ws.onclose = () => {
      console.log("WebSocket connection closed");
    };

    return () => {
      ws.close();
    };
  }, [projectId, accessToken, addSession]);

  return <>{props.children}</>;
}
