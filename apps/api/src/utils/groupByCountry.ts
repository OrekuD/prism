import { Session } from "../models/Session";

export function groupByCountry(sessions: Array<Session>) {
  const map: Map<string, number> = new Map();

  sessions.forEach(({ country_code }) => {
    if (!country_code) return;
    if (map.has(country_code)) {
      const oldValue = map.get(country_code);
      map.set(country_code, oldValue! + 1);
    } else {
      map.set(country_code, 1);
    }
  });

  return map;
}
