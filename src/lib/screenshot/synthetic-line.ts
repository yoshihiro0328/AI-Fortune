// Public synthetic example; no real LINE screenshot or personal conversation.
export function drawSyntheticLine(
  canvas: HTMLCanvasElement,
  variant = "light",
  width = 640,
) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = width;
  canvas.height = Math.round(width * 1.4);
  const s = width / 640;
  ctx.scale(s, s);
  const dark = variant === "dark",
    bg = variant === "background" ? "#d4c8ba" : dark ? "#20262c" : "#90abc7";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 640, 896);
  ctx.fillStyle = dark ? "#30343a" : "#f5f5f5";
  ctx.fillRect(0, 0, 640, 90);
  ctx.fillStyle = dark ? "white" : "#222";
  ctx.font = "24px sans-serif";
  ctx.fillText(
    variant === "group" ? "合成グループ（3）" : "架空の友人（合成）",
    70,
    56,
  );
  ctx.font = "16px sans-serif";
  ctx.fillText("10月28日", 280, 120);
  const messages = [
    { side: "other", text: ["今週、少し話せる？"], y: 145, w: 345 },
    { side: "me", text: ["予定を確認してみるね。"], y: 245, w: 380 },
    {
      side: "me",
      text: ["金曜日なら時間があるよ。", "無理のない時間にしよう。"],
      y: 345,
      w: 420,
    },
    { side: "other", text: ["ありがとう"], y: 490, w: 240 },
  ];
  if (variant === "reply-date") {
    messages[0].text = ["返信ありがとう"];
    messages[1].text = ["10月28日"];
    messages[2].text = ["返信は明日で大丈夫だよ"];
  }
  if (variant === "body-date-only") {
    ctx.fillStyle = bg;
    ctx.fillRect(250, 95, 160, 35);
    messages[0].text = ["10月28日"];
    messages[1].text = ["その日はどうかな"];
  }
  if (variant === "repeat")
    messages.push({ side: "me", text: ["ありがとう"], y: 590, w: 240 });
  if (variant === "quote")
    messages[2].text = ["予定を確認してみるね。", "金曜日なら時間があるよ。"];
  if (variant === "emoji") messages[0].text = ["ありがとう🙂 また話そう"];
  const boxes: {
    speaker: "me" | "other";
    text: string;
    box: { x0: number; y0: number; x1: number; y1: number };
  }[] = [];
  for (const m of messages) {
    const x = m.side === "me" ? 610 - m.w : 70,
      h = 40 + m.text.length * 32;
    ctx.fillStyle =
      m.side === "me"
        ? dark
          ? "#557d62"
          : "#b9e2a8"
        : dark
          ? "#454d55"
          : "#fff";
    ctx.beginPath();
    ctx.roundRect(x, m.y, m.w, h, 18);
    ctx.fill();
    if (m.side === "other") {
      ctx.fillStyle = "#d9bbaa";
      ctx.beginPath();
      ctx.arc(33, m.y + 22, 18, 0, Math.PI * 2);
      ctx.fill();
    }
    if (variant === "quote" && m === messages[2]) {
      ctx.fillStyle = "#d4dfca";
      ctx.fillRect(x + 12, m.y + 8, m.w - 24, 40);
    }
    ctx.fillStyle = dark ? "#fff" : "#172019";
    ctx.font = (variant === "small" ? "12" : "24") + "px sans-serif";
    m.text.forEach((line, i) => {
      if (variant === "quote" && m === messages[2])
        ctx.font = (i === 0 ? "18" : "24") + "px sans-serif";
      ctx.fillText(
        line,
        x + 18,
        m.y + 35 + i * (variant === "quote" && m === messages[2] ? 48 : 32),
      );
    });
    ctx.font = "15px sans-serif";
    ctx.fillStyle = dark ? "#eee" : "#233";
    ctx.fillText("19:35", m.side === "me" ? x - 48 : x + m.w + 8, m.y + h - 10);
    if (m.side === "me") ctx.fillText("既読", x - 40, m.y + h - 30);
    boxes.push({
      speaker: m.side as "me" | "other",
      text: m.text.join("\n"),
      box: { x0: x * s, y0: m.y * s, x1: (x + m.w) * s, y1: (m.y + h) * s },
    });
  }
  if (variant === "media") {
    ctx.fillStyle = dark ? "#454d55" : "#fff";
    ctx.beginPath();
    ctx.roundRect(70, 600, 230, 150, 18);
    ctx.fill();
    ctx.fillStyle = "#caa771";
    ctx.fillRect(95, 625, 170, 100);
    ctx.fillStyle = "#497b57";
    ctx.beginPath();
    ctx.moveTo(95, 725);
    ctx.lineTo(170, 650);
    ctx.lineTo(265, 725);
    ctx.fill();
  }
  if (variant === "sticker") {
    ctx.fillStyle = "#f5c961";
    ctx.beginPath();
    ctx.arc(130, 660, 55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#243528";
    for (const x of [110, 150]) {
      ctx.beginPath();
      ctx.arc(x, 650, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(130, 668, 20, 0, Math.PI);
    ctx.stroke();
  }
  if (variant === "unreadable") {
    const tiny = document.createElement("canvas");
    tiny.width = 30;
    tiny.height = 6;
    tiny
      .getContext("2d")!
      .drawImage(canvas, 70 * s, 145 * s, 345 * s, 72 * s, 0, 0, 30, 6);
    ctx.drawImage(tiny, 70, 145, 345, 72);
    tiny.width = 0;
    tiny.height = 0;
  }
  if (variant === "clipped") {
    ctx.fillStyle = dark ? "#454d55" : "#fff";
    ctx.beginPath();
    ctx.roundRect(70, 850, 300, 100, 18);
    ctx.fill();
    ctx.fillStyle = dark ? "white" : "black";
    ctx.font = "24px sans-serif";
    ctx.fillText("途中で切れている", 90, 887);
  }
  if (variant === "deleted") {
    ctx.fillStyle = "#172019";
    ctx.font = "18px sans-serif";
    ctx.fillText("メッセージの送信を取り消しました", 100, 650);
  }
  if (variant === "plain") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 640, 896);
    ctx.fillStyle = "#111";
    ctx.font = "24px sans-serif";
    ctx.fillText("合成画像：架空の名前・アイコン", 20, 60);
    ctx.fillText("これは吹き出しのない平文です", 20, 150);
  }
  return boxes;
}
