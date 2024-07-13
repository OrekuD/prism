import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { useActiveSessionsStore } from "@/store/activeSessionsStore";
import { SocketConnectProject, SocketMessageTypes } from "@prism/types";
import React from "react";

type Props = {
  projectId?: string;
};

export function WebSocketManager(props: React.PropsWithChildren<Props>) {
  const [socket, setSocket] = React.useState<WebSocket | null>(null);
  const activeSessionsStore = useActiveSessionsStore();

  React.useEffect(() => {
    if (!props.projectId) return;

    // const url = import.meta.env.DEV
    //   ? import.meta.env.VITE_API_URL.slice(7)
    //   : import.meta.env.VITE_API_URL.slice(8);

    const url = `localhost:8080`;

    const protocol = import.meta.env.DEV ? "ws" : "wss";

    const ws = new WebSocket(`${protocol}://${url}/ws`);

    ws.onopen = () => {
      console.log("WebSocket connection established");
      const message: SocketConnectProject = {
        type: "connect-project",
        data: {
          projectId: props.projectId!,
          accessToken: localStorage.getItem(LocalStorageKeys.TOKEN) || "",
        },
      };
      ws.send(JSON.stringify(message));
      setSocket(ws);
    };

    ws.onerror = () => {
      console.log("Could not establish a connection");
    };

    ws.onmessage = (event) => {
      console.log("message");

      const message: SocketMessageTypes = JSON.parse(event.data);

      switch (message.type) {
        case "user-connected":
          // console.log({ message });
          activeSessionsStore.addSession(message.data.session);
          break;
      }

      console.log("message");
    };

    ws.onclose = () => {
      console.log("WebSocket connection closed");
    };

    return () => {
      ws.close();
    };
  }, [props.projectId]);

  return <>{props.children}</>;
}
