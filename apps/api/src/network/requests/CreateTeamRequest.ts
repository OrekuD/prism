import { z } from "zod";

export const CreateTeamRequestSchema = z.strictObject({
  name: z.string(),
});

type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;

export default CreateTeamRequest;
