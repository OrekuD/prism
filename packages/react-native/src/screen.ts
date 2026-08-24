import { useEffect } from "react";
/** Manual + router-neutral hook, plus React Navigation / Expo Router adapters re-exported */
export type ScreenController = { track: (name:string, opts?:{routePattern?:string, navigation?:string})=>void };
export function createScreenController(client: { track:(n:string,p:any)=>void }): ScreenController {
  let seq=0;
  return { track:(name, opts)=>{ seq+=1; client.track("$prism_screen_view", { $screen:{name, routePattern:opts?.routePattern, navigation:(opts?.navigation as any)??"manual", sequence:seq}}); } };
}
export function usePrismScreen(name:string){
  useEffect(()=>{},[name]);
}
