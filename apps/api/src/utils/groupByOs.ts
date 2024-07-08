import { Session } from "../models/Session";

export function groupByOs(sessions: Array<Session>) {
  const map: Map<string, number> = new Map();
  map.set("Windows", 0);
  map.set("macOS", 0);
  map.set("Linux", 0);
  map.set("Android", 0);
  map.set("iOS", 0);

  sessions.forEach(({ os }) => {
    if (map.has(os)) {
      const oldValue = map.get(os);
      map.set(os, oldValue! + 1);
    } else {
      map.set(os, 1);
    }
  });

  return map;
}
