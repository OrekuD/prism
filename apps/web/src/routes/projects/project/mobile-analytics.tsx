import { useParams } from "react-router-dom";
import { Frame } from "@/components/public/frame";
import { useQuery } from "@tanstack/react-query";
export function ProjectMobileAnalytics(){ return MobileAnalyticsPage(); }
export default function MobileAnalyticsPage(){
  const { slug } = useParams();
  const q = useQuery({ queryKey:["mobile-analytics", slug], queryFn: async()=>{ const r=await fetch(`/api/projects/${slug}/mobile-analytics?from=${Date.now()-86400000}&to=${Date.now()}`); if(!r.ok) throw new Error("load failed"); return r.json(); }, enabled: !!slug });
  if(q.isPending) return <Frame><div className="p-6">Loading mobile analytics…</div></Frame>;
  if(q.isError) return <Frame><div className="p-6 text-red-600">Failed to load. {(q.error as Error).message}</div></Frame>;
  if(!q.data || q.data.totals.appOpens===0) return <Frame><div className="p-6"><h1 className="text-lg font-semibold">Mobile analytics</h1><p className="text-sm text-fd-muted-foreground">No mobile data yet. Install @prism-analytics/react-native and send a screen view.</p></div></Frame>;
  return <Frame><div className="p-6"><h1 className="text-lg font-semibold">Mobile analytics</h1><pre className="text-xs mt-4">{JSON.stringify(q.data.totals,null,2)}</pre></div></Frame>;
}
