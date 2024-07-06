export type AppOpen = {
  event: "app-open";
};

export type AppSignIn = {
  event: "app-sign-in";
  text: boolean;
};

export type AppSignUp = {
  event: "app-sign-in";
  data: string;
};

export type AppEvent = AppOpen | AppSignIn | AppSignUp;
