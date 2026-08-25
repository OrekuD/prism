/**
 * Minimal ambient declaration for the React Native modules the Prism SDK
 * touches. In an app, Metro + @types/react-native (or RN's own types)
 * provide the full surface - this exists so the PACKAGE can produce
 * declarations without depending on RN tooling.
 */
declare module "react-native" {
	export interface AppStateEvent {
		addEventListener(
			type: string,
			listener: (state: string) => void,
		): { remove(): void };
	}
	export const AppState: AppStateEvent;
	export const Platform: { OS: string };
	export const Dimensions: {
		get(dim: "window" | "screen"): { width: number; height: number };
	};
}
