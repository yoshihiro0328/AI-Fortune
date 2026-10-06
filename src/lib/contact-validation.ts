import { z } from "zod";
export const contactSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  message: z.string().trim().min(10).max(5000),
  website: z.string().max(200).default(""),
  startedAt: z.number().finite(),
  consent: z.literal(true),
});
