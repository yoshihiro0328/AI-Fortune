-- Each generation is recorded before calling the provider; only reviewed reports reach users.
alter table public.ai_calls add column input_hash text, add column output_json jsonb;
create index ai_calls_editorial_cache on public.ai_calls(diagnosis_id,stage,prompt_version,model,input_hash) where success;
-- Existing service-only RLS/grants also protect drafts and editorial reviews.
