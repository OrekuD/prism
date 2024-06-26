import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DatabaseTables } from '../../types/types';

export const users = pgTable(
	DatabaseTables.USERS,
	{
		id: uuid('id').defaultRandom().primaryKey(),
		email: text('email').notNull(),
		user_name: text('user_name'),
		password: text('password').notNull(),
		role: integer('role').notNull(),
		created_at: timestamp('created_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
		updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
	},
	(table) => {
		return {
			emailIndex: uniqueIndex('email_index').on(table.email),
		};
	}
);
