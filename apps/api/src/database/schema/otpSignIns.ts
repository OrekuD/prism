import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { DatabaseTables } from '../../types/types';
import { users } from './users';

export const otpSignIns = pgTable(
	DatabaseTables.OTP_SIGN_INS,
	{
		id: uuid('id').defaultRandom().primaryKey(),
		user_id: uuid('user_id')
			.references(() => users.id, {
				onDelete: 'cascade',
			})
			.notNull(),
		otp: text('otp').notNull(),
		expiry_at: timestamp('expiry_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
		created_at: timestamp('created_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
		updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string', precision: 6 }).notNull().defaultNow(),
	},
	(table) => {
		return {
			otpIndex: uniqueIndex('otp_index').on(table.otp),
		};
	}
);
