import type { Session } from "../models/Session";

export function groupByCountry(sessions: Array<Session>) {
  const map: Map<string, number> = new Map();

  for (const { country_code } of sessions) {
    if (!country_code) continue;
    const oldValue = map.get(country_code);
    if (oldValue !== undefined) {
      map.set(country_code, oldValue + 1);
    } else {
      map.set(country_code, 1);
    }
  }

  return map;
}
