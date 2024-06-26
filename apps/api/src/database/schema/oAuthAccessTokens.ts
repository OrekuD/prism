import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DatabaseTables } from '../../types/types';
import { users } from './users';

export const oAuthAccessTokens = pgTable(
	DatabaseTables.OAUTH_ACCESS_TOKENS,
	{
		id: uuid('id').defaultRandom().primaryKey(),
		user_id: uuid('user_id')
			.references(() => users.id, {
				onDelete: 'cascade',
			})
			.notNull(),
		access_token: text('access_token').notNull(),
		refresh_token: text('refresh_token').notNull(),
		is_revoked: boolean('is_revoked').default(false).notNull(),
		expiry_at: timestamp('expiry_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
		refresh_expiry_at: timestamp('refresh_expiry_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
		created_at: timestamp('created_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
		updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
	},
	(table) => {
		return {
			accessTokenIndex: uniqueIndex('access_token_index').on(table.access_token),
		};
	}
);
