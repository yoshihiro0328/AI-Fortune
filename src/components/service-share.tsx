"use client";
import { useState } from "react";
import { track } from "@/lib/client";
export default function ServiceShare() {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      const url = location.origin + "/diagnosis/partner-mind?source=share";
      await navigator.clipboard.writeText(
        "恋愛で迷ったとき、今の状況を一緒に整理できる「よりそい」。初回診断無料・登録不要。\n" +
          url,
      );
      setMessage(
        "サービスの紹介文をコピーしました。相談内容は含まれていません。",
      );
      track("service_share");
    } catch {
      setMessage("コピーできませんでした。このページのURLを共有できます。");
    }
  }
  return (
    <div className="share-tools">
      <button className="text-button" onClick={copy}>
        個人情報を含まない紹介文をコピー
      </button>
      <p className="fine">共有は任意です。相談本文や診断結果は含めません。</p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
