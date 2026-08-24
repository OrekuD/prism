import { AppState } from "react-native";
/** AppState lifecycle - foreground flush + background bounded, composes prior handlers */
export function installAppLifecycle(client: { flush:()=>Promise<void>}): ()=>void {
  const sub = AppState.addEventListener("change", (next)=> {
    if(next==="active") void client.flush();
  });
  return ()=> sub.remove();
}
