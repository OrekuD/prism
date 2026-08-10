import type { ZodError } from "zod";

export function parseError(error: ZodError): Array<string> {
  const list: Array<string> = [];

  try {
    for (const issue of error.issues) {
      const field = issue.path.length > 0 ? String(issue.path[0]) : "";
      const message = issue.message;

      if (field) {
        list.push(`"${field}" ${message}`);
      } else {
        list.push(message);
      }
    }
  } catch (_) {
    return list;
  }
  return list;
}
