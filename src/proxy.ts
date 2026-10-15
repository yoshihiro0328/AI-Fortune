import { NextRequest, NextResponse } from "next/server";
import { demoEnabled } from "@/lib/demo/config";

function protect(response: NextResponse) {
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  );
  return response;
}
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!demoEnabled()) return NextResponse.next();
  // Never reach the real API, webhook, auth callback, server action or provider.
  if (
    !["GET", "HEAD"].includes(request.method) ||
    /^\/(api|auth|admin)(\/|$)/.test(path)
  ) {
    return protect(
      NextResponse.json(
        {
          error: "DEMO_ISOLATED",
          message: "デモでは実サービスの操作はできません。",
        },
        { status: 403 },
      ),
    );
  }
  if (path === "/robots.txt")
    return protect(
      new NextResponse("User-agent: *\nDisallow: /\n", {
        headers: { "Content-Type": "text/plain" },
      }),
    );
  if (path === "/sitemap.xml")
    return protect(new NextResponse(null, { status: 404 }));
  // Image optimization can fetch remote URLs; it is not needed by this demo.
  if (path.startsWith("/_next/image"))
    return protect(new NextResponse(null, { status: 403 }));
  if (path === "/preview-demo" || path.startsWith("/preview-demo/"))
    return protect(NextResponse.next());
  const url = request.nextUrl.clone();
  url.pathname = "/preview-demo" + (path === "/" ? "" : path);
  return protect(NextResponse.rewrite(url));
}
export const config = {
  matcher: ["/((?!_next/static/|_next/webpack-hmr|icon.svg$|favicon.ico$).*)"],
};
