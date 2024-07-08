import { Session } from "../models/Session";

export function groupByBrowsers(sessions: Array<Session>) {
  const map: Map<string, number> = new Map();
  map.set("Firefox", 0);
  map.set("Chrome", 0);
  map.set("Safari", 0);
  map.set("Opera", 0);
  map.set("Edge", 0);
  map.set("Internet Explorer", 0);

  sessions.forEach(({ browser }) => {
    if (map.has(browser)) {
      const oldValue = map.get(browser);
      map.set(browser, oldValue! + 1);
    } else {
      map.set(browser, 1);
    }
  });

  return map;
}
