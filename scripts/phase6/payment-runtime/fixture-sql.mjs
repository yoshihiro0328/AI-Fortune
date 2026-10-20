import { TARGET, insist, uuid } from "./policy.mjs";
const literal = (v) => "'" + String(v).replaceAll("'", "''") + "'";
export const freeExample = {
  summary:"【合成データ・決済検証用】架空の診断です。",positive_signals:[],attention_signals:[],
  advice:"購入権限の確認用であり、AIによる助言ではありません。",
  scores:{relationship_stability:50,communication:50,improvement_potential:50},
  uncertainties:["合成データです。実在人物に関する推定はありません。"],
};
export function seedSql(m) {
  insist([m.run,m.diagnosis,m.answer,m.freeReport,m.type,m.a.id,m.b.id].every(uuid));
  insist(new Set([m.diagnosis,m.answer,m.freeReport]).size === 3 && m.a.id !== m.b.id);
  insist(/^[a-f0-9]{64}$/.test(m.anonymousHash));
  return `BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='3s';
LOCK TABLE public.diagnoses,public.diagnosis_answers,public.free_reports,public.payments,public.paid_reports,public.subscriptions,public.billing_customers,public.ai_calls,public.price_versions IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.payment_environment,trial_private.settings,public.profiles,auth.users IN SHARE MODE;
DO $payment_fixture$
DECLARE n integer; profiles_before text;
BEGIN
IF current_database()<>'postgres' OR NOT EXISTS(SELECT 1 FROM public.payment_environment WHERE id AND mode='sandbox' AND stripe_account_id=${literal(TARGET.account)}) THEN RAISE EXCEPTION 'PAYMENT_TARGET_MISMATCH'; END IF;
IF (SELECT count(*) FROM auth.users)<>2 OR (SELECT count(*) FROM auth.users WHERE id IN (${literal(m.a.id)},${literal(m.b.id)}) AND email_confirmed_at IS NOT NULL)<>2 OR (SELECT count(*) FROM public.profiles)<>2 THEN RAISE EXCEPTION 'PAYMENT_USERS_MISMATCH'; END IF;
IF EXISTS(SELECT 1 FROM trial_private.settings WHERE enabled) OR NOT EXISTS(SELECT 1 FROM trial_private.settings WHERE id AND NOT enabled) THEN RAISE EXCEPTION 'TRIAL_MUST_STAY_OFF'; END IF;
IF EXISTS(SELECT 1 FROM public.diagnoses) OR EXISTS(SELECT 1 FROM public.diagnosis_answers) OR EXISTS(SELECT 1 FROM public.free_reports) OR EXISTS(SELECT 1 FROM public.payments) OR EXISTS(SELECT 1 FROM public.paid_reports) OR EXISTS(SELECT 1 FROM public.subscriptions) OR EXISTS(SELECT 1 FROM public.billing_customers) OR EXISTS(SELECT 1 FROM public.ai_calls) THEN RAISE EXCEPTION 'PAYMENT_PREEXISTING_DATA'; END IF;
IF (SELECT count(*) FROM public.price_versions)<>6 OR EXISTS(SELECT 1 FROM public.price_versions WHERE active) THEN RAISE EXCEPTION 'PAYMENT_PRICES_MISMATCH'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.diagnosis_types WHERE id=${literal(m.type)} AND slug='partner-mind' AND is_active) THEN RAISE EXCEPTION 'DIAGNOSIS_TYPE_MISMATCH'; END IF;
SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) INTO profiles_before FROM public.profiles p;
INSERT INTO public.diagnoses(id,user_id,anonymous_session_id,diagnosis_type_id,status,question_flow_version,classification_json) VALUES(${literal(m.diagnosis)},${literal(m.a.id)},${literal(m.anonymousHash)},${literal(m.type)},'free_result_ready','v1',${literal(JSON.stringify({relationship_type:'synthetic',primary_concern:'payment-test',user_goal:'permission-test',emotional_intensity:'low',risk_detected:false,confidence:1,risk_type:'none',severity:'none',synthetic_run:m.run}))}::jsonb);
INSERT INTO public.diagnosis_answers(id,diagnosis_id,question_key,question_text,answer_text) VALUES(${literal(m.answer)},${literal(m.diagnosis)},'payment_synthetic','【合成】表示確認用の質問','【合成】架空の人物甲と乙の表示確認です。');
INSERT INTO public.free_reports(id,diagnosis_id,report_json,model,prompt_version) VALUES(${literal(m.freeReport)},${literal(m.diagnosis)},${literal(JSON.stringify(freeExample))}::jsonb,'synthetic-no-ai',${literal('payment-'+m.run)});
UPDATE public.price_versions SET active=true WHERE id=${literal(TARGET.version)} AND NOT active AND is_test AND kind='report' AND amount=980 AND currency='jpy' AND stripe_product_id=${literal(TARGET.product)} AND stripe_price_id=${literal(TARGET.price)};
GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'PAYMENT_PRICE_UPDATE_COUNT'; END IF;
IF (SELECT count(*) FROM public.diagnoses)<>1 OR (SELECT count(*) FROM public.diagnosis_answers)<>1 OR (SELECT count(*) FROM public.free_reports)<>1 OR (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM public.profiles p) IS DISTINCT FROM profiles_before THEN RAISE EXCEPTION 'PAYMENT_SEED_POSTCONDITION'; END IF;
END $payment_fixture$;
COMMIT;`;
}
