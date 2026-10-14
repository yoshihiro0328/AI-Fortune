// USD / 1M Standard text tokens; source checked 2026-10-09. Never invent an exchange rate.
// Unlisted models return null unless all explicit environment rates are configured.
export function estimateCost(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
    };
  },
  env: Record<string, string | undefined> = process.env,
) {
  const known: Record<string, number[]> = {
    "gpt-6-luna": [0.1, 0.01, 0.125, 0.5],
    "gpt-6.1-sol": [2, 0.1, 2.5, 10],
  };
  const names = [
    "OPENAI_INPUT_USD_PER_MILLION",
    "OPENAI_CACHED_USD_PER_MILLION",
    "OPENAI_CACHE_WRITE_USD_PER_MILLION",
    "OPENAI_OUTPUT_USD_PER_MILLION",
  ];
  const custom = names.map((n) => env[n]);
  const rates =
    known[model] ??
    (custom.every(
      (x) =>
        x !== undefined &&
        x.trim() !== "" &&
        Number.isFinite(Number(x)) &&
        Number(x) >= 0,
    )
      ? custom.map(Number)
      : null);
  const cached = usage.input_tokens_details?.cached_tokens ?? 0,
    writes = usage.input_tokens_details?.cache_write_tokens ?? 0;
  if (!rates || cached + writes > usage.input_tokens)
    return { estimated_usd: null, pricing_source: null };
  return {
    estimated_usd:
      ((usage.input_tokens - cached - writes) * rates[0] +
        cached * rates[1] +
        writes * rates[2] +
        usage.output_tokens * rates[3]) /
      1e6,
    pricing_source: known[model]
      ? "https://developers.openai.com/api/docs/models/" +
        model +
        " (Standard, 2026-10-09)"
      : "configured USD rates (estimate)",
  };
}
