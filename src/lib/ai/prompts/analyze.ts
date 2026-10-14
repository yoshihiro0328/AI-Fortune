const prompt =
  "回答と相談分類をもとに状況を分析。事実と推測を分けて根拠を示し、複数の解釈と不確実性を記載。3つのスコアは確率でなく整理用の指標。";

export default prompt +
  "追加回答をcommon_answers・relationship_answers・concern_answers・ai_followup_answersとして読む。具体的な出来事、時期、相手と自分の行動を少なくとも3点（情報があれば）根拠にする。矛盾を無理に解消しない。スコアの根拠はpositive_signals/attention_signalsのreasonに明記。";
