// Preserve stored reports. Only unambiguous, explicitly quoted drafts can be
// copied; surrounding conditions remain visible, including advice not to send.
export function messageDraft(source: string) {
  const opens = [...source.matchAll(/「/g)];
  const closes = [...source.matchAll(/」/g)];
  if (opens.length !== 1 || closes.length !== 1)
    return { message: null, note: source };
  const start = opens[0].index!,
    end = closes[0].index!;
  if (end <= start + 1) return { message: null, note: source };
  return {
    message: source.slice(start + 1, end),
    note: [source.slice(0, start), source.slice(end + 1)]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n"),
  };
}
