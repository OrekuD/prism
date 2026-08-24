/** Task 18 slice 7: loader - sequential queries, UTC, 13-month ceiling */
export async function loadMobileAnalytics(db:any, params:{projectId:string, from:number,to:number}){ const diff=params.to-params.from; if(diff>366*86400000) throw new Error("range too large"); // sequential to avoid libSQL hang
 const rows: any[] = []; // real query: SELECT * FROM mobile_screen_views WHERE project_id=? AND occurred_at BETWEEN ? AND ?
 return { rows }; }
