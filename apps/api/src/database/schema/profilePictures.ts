import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DatabaseTables } from '../../types/types';
import { users } from './users';

export const profilePictures = pgTable(
	DatabaseTables.PROFILE_PICTURES,
	{
		id: uuid('id').defaultRandom().primaryKey(),
		user_id: uuid('user_id')
			.references(() => users.id, {
				onDelete: 'cascade',
			})
			.notNull(),
		profile_picture_url: text('profile_picture_url').notNull(),
		profile_picture_id: text('profile_picture_id').notNull(),
		created_at: timestamp('created_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
		updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
	},
	(table) => {
		return {
			profilePictureUserIdIndex: uniqueIndex('profile_picture_user_id_index').on(table.user_id),
		};
	},
);
