export async function request<T>(url: string, data?: unknown): Promise<T> {
  const r = await fetch(
    url,
    data === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "通信に失敗しました。");
  return j;
}
export function track(name: string, id?: string) {
  void request("/api/events", { name, id }).catch(() => {});
}
export type Question = {
  id?: string;
  question_key: string;
  question_text: string;
  question_type: string;
  options_json: string[];
  placeholder?: string;
  required: boolean;
};
export type Diagnosis = {
  id: string;
  status: string;
  answers: { question_key: string; answer_text: string }[];
  followup: Question[];
  free_report: import("./ai/schemas").FreeReport | null;
  payment_status: string | null;
};
