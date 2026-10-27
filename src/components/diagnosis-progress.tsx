import { phaseLabels, type Phase } from "@/lib/questions/labels";

/** Counts only the questions currently provided by the server, not a predicted total. */
export default function DiagnosisProgress({
  index,
  count,
  phase = "common",
  dynamic,
  followup,
}: {
  index: number;
  count: number;
  phase?: Phase;
  dynamic: boolean;
  followup: boolean;
}) {
  const label = dynamic
    ? phaseLabels[phase]
    : followup
      ? "最終確認"
      : "基本情報";
  const position =
    dynamic || !followup ? `第${index + 1}問` : `追加確認の第${index + 1}問`;
  return (
    <>
      <div className="meta">{label}</div>
      <p className="question-progress" aria-live="polite">
        <strong>{position}</strong> · 現在用意されている質問は{count}問
        <span>
          回答に応じて質問が追加されるため、診断全体の総数ではありません。
        </span>
      </p>
      <progress
        className="progress"
        max={4}
        value={
          dynamic
            ? ["common", "relationship", "concern", "ai_followup"].indexOf(
                phase,
              ) + 1
            : followup
              ? 4
              : 1
        }
        aria-label="診断の段階"
        aria-valuetext={`${label}・${position}`}
      />
    </>
  );
}
