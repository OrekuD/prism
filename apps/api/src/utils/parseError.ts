import { ZodError } from "zod";

export function parseError(error: ZodError): Array<string> {
  const list: Array<string> = [];

  try {
    error.issues.forEach((issue) => {
      const field = issue.path.length > 0 ? issue.path[0] : "";
      const message = issue.message;

      if (field) {
        list.push(`"${field}" ${message}`);
      } else {
        list.push(message);
      }
    });
  } catch (_) {
    return list;
  }
  return list;
}
