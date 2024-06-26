import { z } from 'zod';
import parseError from './parseError';

/**
 * @returns T | Array<string> -> Array of error strings
 * @param schema - zod schema
 * @param data - data to validate
 */

export default function validateData<T>(schema: ReturnType<typeof z.strictObject>, data: T): T | Array<string> {
	try {
		return schema.parse(data, {}) as T;
	} catch (error: any) {
		// throw new JSONError('invalid_data', parseError(error), 400);
		return parseError(error);
	}
}
