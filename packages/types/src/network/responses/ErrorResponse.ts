export type ErrorResource = {
	errors: Array<string>;
};

export default class ErrorResponse {
	private errors: Array<string>;

	constructor(errors: string | Array<string>) {
		this.errors = typeof errors === 'string' ? [errors] : errors;
	}

	toJSON(): ErrorResource {
		return {
			errors: this.errors,
		};
	}
}
