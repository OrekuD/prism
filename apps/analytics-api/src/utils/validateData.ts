import type { z, ZodError } from "zod";
import { parseError } from "./parseError.js";

/**
 * @returns T | Array<string> -> Array of error strings
 * @param schema - zod schema
 * @param data - data to validate
 */

export function validateData<T>(
  schema: ReturnType<typeof z.strictObject>,
  data: T,
): T | Array<string> {
  try {
    return schema.parse(data, {}) as T;
  } catch (error) {
    // throw new JSONError('invalid_data', parseError(error), 400);
    return parseError(error as ZodError);
  }
}
