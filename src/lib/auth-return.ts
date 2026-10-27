// Navigation metadata only. Never allow a host, arbitrary path, or consultation body.
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 240) return null;
  const uuid =
    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  if (new RegExp(`^/(?:result|report)/${uuid}$`).test(value)) return value;
  if (
    /^\/consult(?:\?topic=(?:general|reply|crush|distance|reunion))?$/.test(
      value,
    )
  )
    return value;
  if (new RegExp(`^/consult\\?(?:diagnosis|thread)=${uuid}$`).test(value))
    return value;
  return null;
}
export function accountReturnLink(path: string) {
  const next = safeReturnTo(path);
  return next ? "/account?next=" + encodeURIComponent(next) : "/account";
}
