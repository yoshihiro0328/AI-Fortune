"use client";
import { useEffect, useState } from "react";
export default function ProgressNote({ label }: { label: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="notice" role="status" aria-live="polite">
      <p>
        <span className="loading" /> {label}
      </p>
      <p>
        回答を丁寧に読み解いています。通常は1〜3分ほどかかります。あなたは少し肩の力を抜いて、お待ちください。
      </p>
      <p className="fine" aria-live="off">
        経過 {seconds}秒
      </p>
      <p className="fine">
        結果は保存されます。時間がかかった場合も、同じ診断から再開できます。
      </p>
    </div>
  );
}
