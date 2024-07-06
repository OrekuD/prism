import { v4 } from "uuid";

export function generateApiKey() {
  return `pr_${v4().toString().replaceAll("-", "")}`;
}
