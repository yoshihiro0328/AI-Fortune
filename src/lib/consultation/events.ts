import { z } from "zod";
const date = z.iso
  .date()
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
const text = z.string().trim().min(1).max(1000);
export const eventCreate = z
  .object({ id: z.uuid(), subject: z.uuid(), date, text })
  .strict();
export const eventUpdate = z
  .object({ id: z.uuid(), revision: z.number().int().positive(), date, text })
  .strict();
export const eventDelete = z
  .object({ id: z.uuid(), revision: z.number().int().positive() })
  .strict();
export type ManualEvent = {
  id: string;
  subject_id: string;
  event_date: string;
  text: string;
  source_type: "manual";
  revision: number;
};
