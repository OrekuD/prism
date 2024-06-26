import { NeonQueryFunction, neon } from '@neondatabase/serverless';
import { HonoConfig } from '../types/types';
import { Context } from 'hono';

class DatabaseManager {
	private static instance: NeonQueryFunction<false, false>;

	public static getInstance(ctx: Context<HonoConfig>) {
		if (!this.instance) {
			this.instance = neon(ctx.env.DATABASE_URL, { arrayMode: false });
		}

		return this.instance;
	}
}

export default DatabaseManager;
