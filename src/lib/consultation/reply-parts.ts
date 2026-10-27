// Conservative, explicit markers only. Never infer a sendable draft from quotations.
export function replyParts(text: string) {
  const start = "【送信用文面】",
    end = "【文面ここまで】";
  const starts = text.split(start).length - 1,
    ends = text.split(end).length - 1;
  if (!starts || starts !== ends || starts > 3) return null;
  const parts: { kind: "note" | "message"; text: string }[] = [];
  let rest = text;
  while (rest.includes(start)) {
    const a = rest.indexOf(start),
      b = rest.indexOf(end);
    if (b < a || rest.slice(a + start.length, b).includes(start)) return null;
    const message = rest.slice(a + start.length, b).trim();
    if (!message || message.length > 2000) return null;
    if (rest.slice(0, a).trim())
      parts.push({ kind: "note", text: rest.slice(0, a).trim() });
    parts.push({ kind: "message", text: message });
    rest = rest.slice(b + end.length);
  }
  if (rest.includes(end)) return null;
  if (rest.trim()) parts.push({ kind: "note", text: rest.trim() });
  return parts;
}
