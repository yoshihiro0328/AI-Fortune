import { ImageResponse } from "next/og";
export const alt = "よりそい | 相手の心理診断";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "#faf8f3",
        color: "#334d40",
        padding: 90,
        justifyContent: "center",
      }}
    >
      <div style={{ fontSize: 34, letterSpacing: 12 }}>YORISOI</div>
      <div style={{ fontSize: 76, marginTop: 48 }}>Find clarity,</div>
      <div style={{ fontSize: 76 }}>at your own pace.</div>
      <div style={{ fontSize: 26, marginTop: 40 }}>
        AI relationship reflection
      </div>
    </div>,
    size,
  );
}
