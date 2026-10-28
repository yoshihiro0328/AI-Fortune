// Normalized geometry keeps pointer edits aligned at every preview scale.
export type Selection = { x: number; y: number; width: number; height: number };
export type Corner = "nw" | "ne" | "sw" | "se";
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
export function boxBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Selection {
  const ax = clamp(a.x),
    ay = clamp(a.y),
    bx = clamp(b.x),
    by = clamp(b.y);
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}
export function moveSelection(r: Selection, dx: number, dy: number): Selection {
  return {
    ...r,
    x: clamp(r.x + dx, 0, 1 - r.width),
    y: clamp(r.y + dy, 0, 1 - r.height),
  };
}
export function resizeSelection(
  r: Selection,
  corner: Corner,
  dx: number,
  dy: number,
): Selection {
  const min = 0.005;
  const left = corner.endsWith("w")
    ? clamp(r.x + dx, 0, r.x + r.width - min)
    : r.x;
  const top = corner.startsWith("n")
    ? clamp(r.y + dy, 0, r.y + r.height - min)
    : r.y;
  const right = corner.endsWith("e")
    ? clamp(r.x + r.width + dx, left + min, 1)
    : r.x + r.width;
  const bottom = corner.startsWith("s")
    ? clamp(r.y + r.height + dy, top + min, 1)
    : r.y + r.height;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function pixelSelection(r: Selection, w: number, h: number): Selection {
  const x = Math.floor(clamp(r.x) * w),
    y = Math.floor(clamp(r.y) * h);
  const right = Math.min(w, Math.ceil((r.x + r.width) * w)),
    bottom = Math.min(h, Math.ceil((r.y + r.height) * h));
  if (right <= x || bottom <= y) throw Error("画像内に範囲を選んでください。");
  return { x, y, width: right - x, height: bottom - y };
}
