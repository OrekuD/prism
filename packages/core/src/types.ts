/** A named event with optional structured data, sent with a session. */
export type AppEvent = {
  name: string;
  data?: Record<string, unknown>;
};
