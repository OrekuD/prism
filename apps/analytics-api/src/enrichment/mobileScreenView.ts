import { validateScreenViewProperties, validateAppLifecycleProperties } from "@prism-analytics/core";
import { createHash } from "node:crypto";
export function digestInstallation(id: string, salt: string){ return createHash("sha256").update(salt+":"+id).digest("hex").slice(0,32); }
export function enrichMobileScreenView(event: unknown, opts:{ projectId:string; sourceId:string; salt:string }){ 
  const props=(event as any)?.properties; 
  const r=validateScreenViewProperties(props); 
  if(!r.ok) return {ok:false as const, reason:(r as any).reason}; 
  const rawInst = (props as any)?.$installation ?? (props as any)?.$app?.installationId;
  let digest: string | null = null;
  if(typeof rawInst==="string" && rawInst.length>0) digest=digestInstallation(rawInst, opts.salt);
  return {ok:true as const, normalized:r.value, installationDigest:digest, sourceId: opts.sourceId}; 
}
export function enrichAppLifecycle(event: unknown){ 
  const r=validateAppLifecycleProperties((event as any)?.properties); 
  return r.ok? {ok:true as const, value:r.value}:{ok:false as const, reason:(r as any).reason}; 
}
