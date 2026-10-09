"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { request } from "@/lib/client";
export default function Visit() {
  const pathname = usePathname();
  useEffect(() => {
    const ref = new URLSearchParams(location.search).get("source");
    const source = ["guide", "share", "account", "home"].includes(ref ?? "")
      ? ref
      : "direct";
    // Only a coarse source is sent: never URLs, diagnosis IDs or consultation text.
    void request("/api/events", { name: "page_view", source }).catch(() => {});
    if (pathname === "/plans")
      void request("/api/events", { name: "plans_viewed", source }).catch(
        () => {},
      );
  }, [pathname]);
  return null;
}
