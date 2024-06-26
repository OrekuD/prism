export type OkResource = {
	message: string;
};

export default class OkResponse {
	private message: string;

	constructor(message?: string) {
		this.message = message || 'success';
	}

	toJSON(): OkResource {
		return {
			message: this.message,
		};
	}
}
