-- Run within a rollback transaction. All data below is synthetic.
do $$
declare d uuid; t uuid; q jsonb; second jsonb; total int;
begin
 select id into t from public.diagnosis_types where slug='partner-mind';
 insert into public.diagnoses(diagnosis_type_id,anonymous_session_id,question_flow_version) values(t,'dynamic-sql-fixture','v2') returning id into d;
 select to_jsonb(c)||jsonb_build_object('question_source','common','selected_reason','fixture','position',0) into q from public.diagnosis_questions c where question_key='v2_relationship';
 select to_jsonb(c)||jsonb_build_object('question_source','ai_selected','selected_reason','fixture','position',9) into second from public.diagnosis_questions c where question_key='dating_length';
 perform public.save_question_plan(d,'{}',jsonb_build_array(q));
 perform public.save_dynamic_answer(d,'v2_relationship','交際中');
 perform public.save_dynamic_answer(d,'v2_relationship','交際中');
 select count(*) into total from public.diagnosis_answers where diagnosis_id=d;
 if total<>1 then raise exception 'duplicate answer';end if;
 perform public.view_dynamic_question(d,'v2_relationship');perform public.view_dynamic_question(d,'v2_relationship');
 select count(*) into total from public.analytics_events where event_name='dynamic_question_viewed' and metadata->>'diagnosis_id'=d::text;
 if total<>1 then raise exception 'duplicate view';end if;
 perform public.save_question_plan(d,'{"branched":true}',jsonb_build_array(second));
 perform public.save_dynamic_answer(d,'dating_length','半年');
 perform public.save_dynamic_answer(d,'v2_relationship','元恋人');
 if exists(select 1 from public.diagnosis_answers where diagnosis_id=d and question_key='dating_length') then raise exception 'stale answer';end if;
 if not exists(select 1 from public.diagnosis_selected_questions where diagnosis_id=d and question_key='dating_length' and not is_active and answer='半年') then raise exception 'history lost';end if;
 if (select question_flow_json from public.diagnoses where id=d)<>'{}'::jsonb then raise exception 'stale plan';end if;
 if has_table_privilege('anon','public.diagnosis_selected_questions','select') or has_table_privilege('authenticated','public.diagnosis_selected_questions','select') then raise exception 'history exposed';end if;
 if has_function_privilege('anon','public.save_dynamic_answer(uuid,text,text)','execute') or has_function_privilege('authenticated','public.save_question_plan(uuid,jsonb,jsonb)','execute') then raise exception 'RPC exposed';end if;
 if exists(select 1 from public.diagnosis_questions where flow_version='v2' and required) then raise exception 'legacy completion changed';end if;
end $$;
set local role anon;
do $$begin
 if (select count(*) from public.diagnosis_questions)<>10 then raise exception 'legacy public list changed';end if;
 begin perform 1 from public.diagnosis_selected_questions;raise exception 'anon access allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'dynamic database assertions passed' as result;
