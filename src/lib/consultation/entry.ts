import type { ConsultationHome } from "./model";
/** Resolve only a requested, owned target. Never choose an unrelated first subject. */
export function consultationEntry(h: ConsultationHome, p: URLSearchParams) {
  const diagnosis = p.get("diagnosis") ?? "";
  const linked = h.links.find((l) => l.diagnosis_id === diagnosis);
  const subject = p.get("subject") ?? linked?.subject_id;
  if (subject && !h.subjects.some((s) => s.id === subject))
    throw new Error(
      "指定された相談相手は開けません。相談相手を選び直してください。",
    );
  const requested = p.get("thread");
  const thread = requested
    ? h.threads.find((t) => t.id === requested)
    : h.threads.find((t) => t.subject_id === subject);
  if (requested && subject && thread && thread.subject_id !== subject)
    throw new Error(
      "指定された相談は開けません。相談相手を選び直してください。",
    );
  return {
    linked,
    diagnosis: linked ? "" : diagnosis,
    threadId: requested ?? thread?.id,
    subject: h.subjects.find((s) => s.id === (thread?.subject_id ?? subject)),
  };
}
