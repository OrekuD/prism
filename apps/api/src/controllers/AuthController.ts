import { Context } from 'hono';
import { DatabaseTables, HonoConfig, JWTPayload, Roles } from '../types/types';
import SignInRequest, { SignInRequestSchema } from '../network/requests/SignInRequest';
import validateData from '../utils/validateData';
import SignUpRequest, { SignUpRequestSchema } from '../network/requests/SignUpRequest';
import DatabaseManager from '../managers/DatabaseManager';
import User from '../models/User';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import OAuthAccessToken from '../models/OAuthAccessToken';
import jwt, { JwtPayload } from '@tsndr/cloudflare-worker-jwt';
import AuthResponse from '../network/responses/AuthResponse';
import ResetPasswordRequest, { ResetPasswordRequestSchema } from '../network/requests/ResetPasswordRequest';
import ForgotPasswordRequest, { ForgotPasswordRequestSchema } from '../network/requests/ForgotPasswordRequest';
import ErrorResponse from '../network/responses/ErrorResponse';
import OkResponse from '../network/responses/OkResponse';
import LoginAttempt from '../models/LoginAttempt';
import { differenceInMinutes } from 'date-fns/differenceInMinutes';
import MailManager from '../managers/MailManager';
import VerifyEmailRequest, { VerifyEmailRequestSchema } from '../network/requests/VerifyEmailRequest';
import MagicLinkSignInRequest, { MagicLinkSignInRequestSchema } from '../network/requests/MagicLinkSignInRequest';
import RequestMagicLinkSignInRequest, { RequestMagicLinkSignInRequestSchema } from '../network/requests/RequestMagicLinkSignInRequest';
import RequestOTPSignInRequest, { RequestOTPSignInRequestSchema } from '../network/requests/RequestOTPSignInRequest';
import OTPSignIn from '../models/OTPSignIn';
import OTPSignInRequest, { OTPSignInRequestSchema } from '../network/requests/OTPSignInRequest';
import { isPast } from 'date-fns/isPast';
import { addMinutes } from 'date-fns/addMinutes';
import { addDays } from 'date-fns/addDays';
import { addHours } from 'date-fns/addHours';

export default class AuthController {
	public static async signIn(ctx: Context<HonoConfig>) {
		const body = await ctx.req.json<SignInRequest>();

		const data = validateData(SignInRequestSchema, body);

		if (Array.isArray(data)) {
			return ctx.json(new ErrorResponse(data).toJSON(), 400);
		}
		const db = DatabaseManager.getInstance(ctx);

		const user = (await db`
			SELECT
				users.id as id,
				users.email as email,
				users.user_name as user_name,
				users.password as password,
				json_build_object(
					'first_name', profiles.first_name,
					'last_name', profiles.last_name,
					'gender', profiles.gender,
					'email_verified_at', profiles.email_verified_at
				) AS profile
			FROM
				users
			JOIN
				profiles ON users.id = profiles.user_id
			WHERE users.email = ${data.email.trim().toLowerCase()} AND users.role = ${Roles.USER};
		`) as Array<User>;

		if (user.length === 0) {
			return ctx.json(new ErrorResponse('invalid_request').toJSON(), 400);
		}

		if (!bcrypt.compareSync(data.password, user[0].password)) {
			return AuthController._failedLoginAttempt(ctx, user[0].id);
		}

		const loginAttempts =
			(await db`SELECT number_of_attempts, updated_at FROM login_attempts WHERE user_id = ${user[0].id}`) as Array<LoginAttempt>;

		if (loginAttempts.length > 0 && Math.abs(differenceInMinutes(new Date(), new Date(loginAttempts[0].updated_at))) < 30) {
			return ctx.json(new ErrorResponse('max_number_of_failed_login_attempts'), 400);
		}

		await db`DELETE FROM login_attempts WHERE user_id = ${user[0].id}`;

		return AuthController._authenticate(ctx, user[0]);
	}

	public static async magicLinkSignIn(ctx: Context<HonoConfig>) {
		const body = await ctx.req.json<MagicLinkSignInRequest>();

		const data = validateData<MagicLinkSignInRequest>(MagicLinkSignInRequestSchema, body);

		if (Array.isArray(data)) {
			return ctx.json(new ErrorResponse(data).toJSON(), 400);
		}

		const isValid = await jwt.verify(data.token, ctx.env.JWT_SECRET_KEY);

		if (!isValid) {
			return ctx.json(new ErrorResponse('no_token_provided').toJSON(), 400);
		}

		const decoded = jwt.decode<JWTPayload>(data.token);

		if (!decoded.payload) {
			return ctx.json(new ErrorResponse('no_token_provided').toJSON(), 400);
		}

		if (isPast(new Date(decoded.payload.expiryAt))) {
			return ctx.json(new ErrorResponse('token_expired').toJSON(), 400);
		}

		const user = (await DatabaseManager.getInstance(ctx)`
		SELECT
			users.id as id,
			users.email as email,
			users.user_name as user_name,
			users.password as password,
			json_build_object(
				'first_name', profiles.first_name,
				'last_name', profiles.last_name,
				'gender', profiles.gender,
				'email_verified_at', profiles.email_verified_at
			) AS profile
		FROM
			users
		JOIN
			profiles ON users.id = profiles.user_id
		WHERE id = ${decoded.payload.userId} AND users.role = ${Roles.USER};
		`) as Array<User>;

		if (user.length === 0) {
			return ctx.json(new ErrorResponse('user_not_found').toJSON(), 404);
		}

		return AuthController._authenticate(ctx, user[0]);
	}

	public static async requestMagicLinkSignIn(ctx: Context<HonoConfig>) {
		const body = await ctx.req.json<RequestMagicLinkSignInRequest>();

		const data = validateData(RequestMagicLinkSignInRequestSchema, body);

		if (Array.isArray(data)) {
			return ctx.json(new ErrorResponse(data).toJSON(), 400);
		}

		const user = (await DatabaseManager.getInstance(ctx)`SELECT id FROM users WHERE email = ${data.email
			.toLowerCase()
			.trim()}`) as Array<User>;

		if (user.length === 0) {
			return ctx.json(new ErrorResponse('user_not_found').toJSON(), 404);
		}

		const magicLink = await AuthController._generateMagicLink(ctx, user[0].id);

		await MailManager.dispatch(
			ctx,
			{
				name: 'magic-link',
				props: {
					magicLink,
				},
			},
			user[0].email,
		);

		return ctx.json(new OkResponse().toJSON());
	}

	public static async otpSignIn(ctx: Context<HonoConfig>) {
		const body = await ctx.req.json<OTPSignInRequest>();

		const data = validateData<OTPSignInRequest>(OTPSignInRequestSchema, body);

		if (Array.isArray(data)) {
			return ctx.json(new ErrorResponse(data).toJSON(), 400);
		}

		const db = DatabaseManager.getInstance(ctx);

		const otpSignIn =
			(await db`SELECT user_id, otp, expiry_at FROM otp_sign_ins WHERE otp = ${data.otp} AND expiry_at > NOW()`) as Array<OTPSignIn>;

		if (otpSignIn.length === 0) {
			return ctx.json(new ErrorResponse('no_token_provided').toJSON(), 400);
		}

		const user = (await db`
		SELECT
			users.id as id,
			users.email as email,
			users.user_name as user_name,
			users.password as password,
			json_build_object(
				'first_name', profiles.first_name,
				'last_name', profiles.last_name,
				'gender', profiles.gender,
				'email_verified_at', profiles.email_verified_at
			) AS profile
		FROM
			users
		JOIN
			profiles ON users.id = profiles.user_id
		WHERE id = ${otpSignIn[0].user_id} AND users.role = ${Roles.USER};
		`) as Array<User>;

		if (user.length === 0) {
			return ctx.json(new ErrorResponse('user_not_found').toJSON(), 404);
		}

		await db`DELETE FROM otp_sign_ins WHERE id = ${otpSignIn[0].id}`;

		return AuthController._authenticate(ctx, user[0]);
	}

	public static async requestOTPSignIn(ctx: Context<HonoConfig>) {
		const body = await ctx.req.json<RequestOTPSignInRequest>();

		const data = validateData(RequestOTPSignInRequestSchema, body);

		if (Array.isArray(data)) {
			return ctx.json(new ErrorResponse(data).toJSON(), 400);
		}

		const db = DatabaseManager.getInstance(ctx);

		const user = (await db`SELECT id FROM users WHERE email = ${data.email.toLowerCase().trim()}`) as Array<User>;

		if (user.length === 0) {
			return ctx.json(new ErrorResponse('user_not_found').toJSON(), 404);
		}

		const otp = Math.floor(100000 + Math.random() * 900000).toString();

		const expiryAt = addMinutes(new Date(), 10);

		const otpSign =
			(await db`INSERT INTO otp_sign_ins (user_id, otp, expiry_at) VALUES (${user[0].id}, ${otp}, ${expiryAt}) RETURNING id`) as Array<OTPSignIn>;

		if (otpSign.length === 0) {
			return ctx.json(new ErrorResponse('otp_not_created').toJSON(), 400);
		}

		await MailManager.dispatch(
			ctx,
			{
				name: 'otp-sign-in',
				props: {
					otp,
				},
			},
			user[0].email,
		);

		return ctx.json(new OkResponse().toJSON());
	}

	public static async signUp(ctx: Context<HonoConfig>) {
		const body = await ctx.req.json<SignUpRequest>();

		const data = validateData<SignUpRequest>(SignUpRequestSchema, body);

		if (Array.isArray(data)) {
			return ctx.json(new ErrorResponse(data).toJSON(), 400);
		}

		const db = DatabaseManager.getInstance(ctx);

		const users = (await db`SELECT id FROM users WHERE email = ${data.email.trim().toLowerCase()}`) as Array<User>;

		if (users.length > 0) {
			return ctx.json(new ErrorResponse('email_taken').toJSON(), 400);
		}

		const hashedPassword = bcrypt.hashSync(data.password, bcrypt.genSaltSync());

		await db`BEGIN`;

		let user = (await db`INSERT INTO users (email, password, role) VALUES (${data.email.trim().toLowerCase()}, ${hashedPassword}, ${
			Roles.USER
		}) RETURNING id`) as Array<User>;

		const userProfile =
			await db`INSERT INTO profiles (user_id, first_name, last_name) VALUES (${user?.[0]?.id}, ${data.firstname}, ${data.lastname}) RETURNING id`;

		if (userProfile.length === 0 || user.length === 0) {
			await db`ROLLBACK`;

			return ctx.json(new ErrorResponse('user_not_created').toJSON(), 400);
		}

		user = (await db`
		SELECT
			users.id as id,
			users.email as email,
			users.user_name as user_name,
			users.password as password,
			json_build_object(
				'first_name', profiles.first_name,
				'last_name', profiles.last_name,
				'gender', profiles.gender,
				'email_verified_at', profiles.email_verified_at
			) AS profile
			FROM
				users
			JOIN
				profiles ON users.id = profiles.user_id
			WHERE users.email = ${data.email.trim().toLowerCase()} AND users.role = ${Roles.USER};
			`) as Array<User>;

		await db`COMMIT`;

		const verifyEmailLink = await AuthController._generateVerifyEmailURL(ctx, user[0].id);

		await MailManager.dispatch(
			ctx,
			{
				name: 'welcome',
				props: {
					name: user[0].profile?.first_name || user[0].email,
					confirmEmailLink: verifyEmailLink,
				},
			},
			user[0].email,
		);

		return AuthController._authenticate(ctx, user[0]);
	}

	public static async signOut(ctx: Context<HonoConfig>) {
		const oauthAccessTokenId = ctx.get('oauthAccessTokenId');

		if (!oauthAccessTokenId) {
			return ctx.json(new ErrorResponse('invalid_request').toJSON(), 400);
		}

		await DatabaseManager.getInstance(ctx)`DELETE FROM oauth_access_tokens WHERE id = ${oauthAccessTokenId}`;

		return ctx.json(new OkResponse().toJSON());
	}

	public static async verifyEmail(ctx: Context<HonoConfig>) {
		const body = await ctx.req.json<VerifyEmailRequest>();

		const data = validateData<VerifyEmailRequest>(VerifyEmailRequestSchema, body);

		if (Array.isArray(data)) {
			return ctx.json(new ErrorResponse(data).toJSON(), 400);
		}

		const isValid = await jwt.verify(data.token, ctx.env.JWT_SECRET_KEY);

		if (!isValid) {
			return ctx.json(new ErrorResponse('no_token_provided').toJSON(), 400);
		}

		const decoded = jwt.decode<JWTPayload>(data.token);

		if (!decoded.payload) {
			return ctx.json(new ErrorResponse('no_token_provided').toJSON(), 400);
		}

		if (isPast(new Date(decoded.payload.expiryAt))) {
			return ctx.json(new ErrorResponse('token_expired').toJSON(), 400);
		}

		const db = DatabaseManager.getInstance(ctx);

		const user = await db`SELECT id FROM users WHERE id = ${decoded.payload.userId}`;

		if (user.length === 0) {
			return ctx.json(new ErrorResponse('user_not_found').toJSON(), 404);
		}

		await db`UPDATE profiles SET email_verified_at = NOW() WHERE user_id = ${decoded.payload.userId}`;

		return ctx.json(new OkResponse().toJSON());
	}

	public static async resetPassword(ctx: Context<HonoConfig>) {
		const body = await ctx.req.json<ResetPasswordRequest>();

		const data = validateData<ResetPasswordRequest>(ResetPasswordRequestSchema, body);

		if (Array.isArray(data)) {
			return ctx.json(new ErrorResponse(data).toJSON(), 400);
		}

		const isValid = await jwt.verify(data.resetPasswordToken, ctx.env.JWT_SECRET_KEY);

		if (!isValid) {
			return ctx.json(new ErrorResponse('reset_token_invalid').toJSON(), 400);
		}

		const decodedData = jwt.decode<JWTPayload>(data.resetPasswordToken);

		if (!decodedData.payload?.token) {
			return ctx.json(new ErrorResponse('reset_token_invalid').toJSON(), 400);
		}

		if (isPast(new Date(decodedData.payload.expiryAt))) {
			return ctx.json(new ErrorResponse('reset_token_expired').toJSON(), 400);
		}

		const hashedPassword = bcrypt.hashSync(data.password, bcrypt.genSaltSync());

		const db = DatabaseManager.getInstance(ctx);

		await db`UPDATE users SET password = ${hashedPassword} WHERE id = ${decodedData.payload.userId}`;

		await db`DELETE FROM oauth_access_tokens WHERE user_id = ${decodedData.payload.userId}`;

		return ctx.json(new OkResponse().toJSON());
	}

	public static async forgotPassword(ctx: Context<HonoConfig>) {
		const body = await ctx.req.json<ForgotPasswordRequest>();

		const data = validateData<ForgotPasswordRequest>(ForgotPasswordRequestSchema, body);

		if (Array.isArray(data)) {
			return ctx.json(new ErrorResponse(data).toJSON(), 400);
		}

		const user = (await DatabaseManager.getInstance(ctx)`
			SELECT
				users.id as id
				json_build_object(
					'first_name', profiles.first_name
				) AS profile
			FROM users
			JOIN profiles
			ON users.id = profiles.user_id
			WHERE email = ${data.email.trim().toLowerCase()}`) as Array<User>;

		if (user.length === 0) {
			return ctx.json(new ErrorResponse('user_not_found').toJSON(), 404);
		}

		const resetLink = await AuthController._generateResetPasswordURL(ctx, user[0].id);
		await MailManager.dispatch(
			ctx,
			{
				name: 'reset-password',
				props: {
					name: user[0].profile?.first_name || user[0].email,
					resetLink,
				},
			},
			user[0].email,
		);

		return ctx.json(new OkResponse().toJSON());
	}

	public static async _authenticate(ctx: Context<HonoConfig>, user: User) {
		const expiryAt = addDays(new Date(), 30);
		const refreshExpiryAt = addDays(new Date(), 60);
		const refreshTokenString = crypto.randomBytes(64).toString('hex');
		const accessTokenString = crypto.randomBytes(64).toString('hex');

		const oAuthAccessToken = (await DatabaseManager.getInstance(
			ctx,
		)`INSERT INTO oauth_access_tokens (user_id, access_token, refresh_token, expiry_at, refresh_expiry_at) VALUES (${user.id}, ${accessTokenString}, ${refreshTokenString}, ${expiryAt}, ${refreshExpiryAt}) RETURNING id`) as Array<OAuthAccessToken>;

		if (oAuthAccessToken.length === 0) {
			return ctx.json(new ErrorResponse('database_error').toJSON(), 400);
		}

		const accessToken: string = await jwt.sign<JWTPayload>(
			{
				token: accessTokenString,
				expiryAt: expiryAt.getTime(),
				userId: user.id,
			},
			ctx.env.JWT_SECRET_KEY,
			{
				algorithm: 'HS256',
			},
		);

		const refreshToken: string = await jwt.sign<JwtPayload>(
			{
				token: refreshTokenString,
				expiryAt: refreshExpiryAt.getTime(),
				userId: user.id,
			},
			ctx.env.JWT_SECRET_KEY,
			{
				algorithm: 'HS256',
			},
		);

		return ctx.json(new AuthResponse(accessToken, refreshToken, user, expiryAt, refreshExpiryAt).toJSON());
	}

	private static async _failedLoginAttempt(ctx: Context<HonoConfig>, userId: string) {
		const db = DatabaseManager.getInstance(ctx);
		const loginAttempts = (await db`SELECT number_of_attempts FROM login_attempts WHERE user_id = ${userId}`) as Array<LoginAttempt>;
		if (loginAttempts.length === 0) {
			await db`INSERT INTO login_attempts (user_id, number_of_attempts) VALUES (${userId}, 1)`;
		} else {
			if (loginAttempts[0].number_of_attempts >= 10) {
				return ctx.json(new ErrorResponse('max_number_of_failed_login_attempts'), 400);
			}
			await db`UPDATE login_attempts SET number_of_attempts = ${
				loginAttempts[0].number_of_attempts + 1
			}, updated_at = NOW() WHERE user_id = ${userId}`;
		}
		return ctx.json(new ErrorResponse('invalid_request').toJSON(), 400);
	}

	public static async _generateVerifyEmailURL(ctx: Context<HonoConfig>, userId: string) {
		const accessToken = crypto.randomBytes(128).toString('hex');
		const expiryAt = addHours(new Date(), 48);

		const jwtToken = await jwt.sign<JWTPayload>(
			{
				expiryAt: expiryAt.getTime(),
				userId,
				token: accessToken,
			},
			ctx.env.JWT_SECRET_KEY,
			{
				algorithm: 'HS256',
			},
		);

		return `${ctx.env.CLIENT_URL}/verify-email?token=${jwtToken}`;
	}

	public static async _generateMagicLink(ctx: Context<HonoConfig>, userId: string) {
		const accessToken = crypto.randomBytes(128).toString('hex');
		const expiryAt = addMinutes(new Date(), 10);

		const jwtToken = await jwt.sign<JWTPayload>(
			{
				expiryAt: expiryAt.getTime(),
				userId,
				token: accessToken,
			},
			ctx.env.JWT_SECRET_KEY,
			{
				algorithm: 'HS256',
			},
		);

		return `${ctx.env.CLIENT_URL}/auth/login?token=${jwtToken}`;
	}

	public static async _generateResetPasswordURL(ctx: Context<HonoConfig>, userId: string) {
		const accessToken = crypto.randomBytes(128).toString('hex');
		const expiryAt = addHours(new Date(), 8);

		const jwtToken = await jwt.sign<JWTPayload>(
			{
				expiryAt: expiryAt.getTime(),
				userId,
				token: accessToken,
			},
			ctx.env.JWT_SECRET_KEY,
			{
				algorithm: 'HS256',
			},
		);

		return `${ctx.env.CLIENT_URL}/auth/reset-password?token=${jwtToken}`;
	}
}
