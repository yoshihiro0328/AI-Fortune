import "server-only";
import { cookies } from "next/headers";
import { safeReturnTo } from "./auth-return";
const name = "yorisoi_return";
export async function rememberReturn(value: unknown) {
  const jar = await cookies(),
    path = safeReturnTo(value);
  if (path)
    jar.set(name, path, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 3600,
    });
  else jar.delete(name);
}
export async function consumeReturn() {
  const jar = await cookies(),
    path = safeReturnTo(jar.get(name)?.value);
  jar.delete(name);
  return path;
}
