export type ProfilePictureResource = {
	profilePicture: string;
};

export default class ProfilePictureResponse {
	private profilePicture: string;

	constructor(profilePicture: string) {
		this.profilePicture = profilePicture;
	}

	toJSON(): ProfilePictureResource {
		return {
			profilePicture: this.profilePicture,
		};
	}
}
