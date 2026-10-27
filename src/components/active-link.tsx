"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
export default function ActiveLink(props: ComponentProps<typeof Link>) {
  const path = usePathname();
  return (
    <Link
      {...props}
      aria-current={
        typeof props.href === "string" && path === props.href
          ? "page"
          : undefined
      }
    />
  );
}
