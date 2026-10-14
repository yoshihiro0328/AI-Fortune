export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Configuration missing: ${name}`);
  return value;
}
export function appUrl() {
  return required("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
}
