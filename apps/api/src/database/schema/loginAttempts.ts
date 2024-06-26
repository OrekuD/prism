import { integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { DatabaseTables } from '../../types/types';
import { users } from './users';

export const loginAttempts = pgTable(DatabaseTables.LOGIN_ATTEMPTS, {
	id: uuid('id').defaultRandom().primaryKey(),
	user_id: uuid('user_id')
		.references(() => users.id, {
			onDelete: 'cascade',
		})
		.notNull(),
	number_of_attempts: integer('number_of_attempts').notNull(),
	created_at: timestamp('created_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
	updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
});
