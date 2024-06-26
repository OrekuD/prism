import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DatabaseTables } from '../../types/types';
import { users } from './users';

export const profiles = pgTable(
	DatabaseTables.PROFILES,
	{
		id: uuid('id').defaultRandom().primaryKey(),
		user_id: uuid('user_id')
			.references(() => users.id, {
				onDelete: 'cascade',
			})
			.notNull(),
		first_name: text('first_name').notNull(),
		last_name: text('last_name').notNull(),
		gender: text('gender'),
		profile_picture_id: text('profile_picture_id'),
		email_verified_at: timestamp('email_verified_at', { withTimezone: true, mode: 'string', precision: 6 }),
		created_at: timestamp('created_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
		updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
	},
	(table) => {
		return {
			profileUserIdIndex: uniqueIndex('profile_user_id_index').on(table.user_id),
		};
	},
);
