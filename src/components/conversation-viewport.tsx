"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Keeps reading position on older-page loads; new replies never move the page. */
export default function ConversationViewport({
  threadKey,
  firstId,
  children,
  busy,
}: {
  threadKey: string;
  firstId?: string;
  children: ReactNode;
  busy: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const position = useRef({
    thread: "",
    first: "",
    height: 0,
    top: 0,
    atEnd: true,
  });
  useLayoutEffect(() => {
    const el = element.current;
    if (!el) return;
    const old = position.current;
    if (old.thread !== threadKey || old.atEnd) el.scrollTop = el.scrollHeight;
    else if (old.first !== (firstId ?? ""))
      el.scrollTop = old.top + el.scrollHeight - old.height;
    position.current = {
      thread: threadKey,
      first: firstId ?? "",
      height: el.scrollHeight,
      top: el.scrollTop,
      atEnd: el.scrollHeight - el.clientHeight - el.scrollTop < 32,
    };
  });
  return (
    <div
      ref={element}
      className="chat-messages"
      role="region"
      aria-live="polite"
      aria-busy={busy}
      aria-label="会話の履歴（上下にスクロール）"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        position.current = {
          ...position.current,
          top: el.scrollTop,
          height: el.scrollHeight,
          atEnd: el.scrollHeight - el.clientHeight - el.scrollTop < 32,
        };
      }}
    >
      {children}
    </div>
  );
}
