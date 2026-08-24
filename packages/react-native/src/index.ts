import { createPrismClient } from "@prism-analytics/core";
import type { PrismClient } from "@prism-analytics/core";
import { MOBILE_LIMITS, SCREEN_VIEW_EVENT_NAME, APP_LIFECYCLE_EVENT_NAME } from "@prism-analytics/core";
export { MOBILE_LIMITS, SCREEN_VIEW_EVENT_NAME, APP_LIFECYCLE_EVENT_NAME };
export type { PrismClient };
export type ReactNativePrismOptions = {
  sourceKey: string;
  endpoint: string;
  storage?: any;
  collection?: { initialState: "granted" | "pending" | "denied" };
};
function rnCreateId(): string { const g = globalThis as any; if (g.crypto?.randomUUID) return g.crypto.randomUUID(); const b=new Uint8Array(16); if(g.crypto?.getRandomValues) g.crypto.getRandomValues(b); else for(let i=0;i<16;i++) b[i]=Math.floor(Math.random()*256); b[6]=(b[6]&0x0f)|0x40; b[8]=(b[8]&0x3f)|0x80; const h=[...b].map(x=>x.toString(16).padStart(2,"0")).join(""); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; }
let _installed=false;
export async function createReactNativeClient(opts: ReactNativePrismOptions): Promise<PrismClient> {
  if(_installed) throw new Error("Prism already initialized: call shutdown() first");
  _installed=true;
  const storage = opts.storage ?? { getItem: async()=>null, setItem: async()=>{}, removeItem: async()=>{} };
  const transport = { post: async(url:string, req:any)=>{ const controller=new AbortController(); const onAbort=()=>controller.abort(); req.signal?.addEventListener?.("abort", onAbort); const r=await fetch(url, {method:"POST", headers:req.headers, body:req.body, signal:controller.signal}); req.signal?.removeEventListener?.("abort", onAbort); return {status:r.status, headers:Object.fromEntries((r.headers as any).entries()), text: ()=>r.text()}; } };
  const runtime: any = { name: "react-native", now: ()=>Date.now(), createId: rnCreateId, transport, storage, schedule: (d:number,cb:()=>void)=>{ const id=setTimeout(cb,d); return ()=>clearTimeout(id); }, context: { kind: "mobile", platform: "react-native", os: "ios" }, lifecycle: { on: (evt:string, cb:()=>void)=>{ let sub:any=null; try{ const { AppState } = require("react-native"); sub=AppState.addEventListener("change", (s:string)=>{ if(s==="active"&&evt==="foreground") cb(); if(s==="background"&&evt==="background") cb(); }); }catch{ sub={remove:()=>{}}; } return ()=>sub.remove(); } } };
  const client = await createPrismClient({ sourceKey: opts.sourceKey, endpoint: opts.endpoint, collection: opts.collection ?? { initialState: "granted" }, runtime } as any);
  const origShutdown = (client as any).shutdown?.bind(client);
  if(origShutdown) (client as any).shutdown = async()=>{ _installed=false; return origShutdown(); };
  return client;
}
export function resetReactNativeInstallForTests(){ _installed=false; }
