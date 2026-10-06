begin;
select public.submit_contact('90000000-0000-4000-8000-000000000099','Mail test','mail@example.test','Synthetic test',null,'[{"kind":"receipt","dedupe_key":"db-test-mail","payload":{}}]');
do $$ declare n integer; begin
 select count(*) into n from public.claim_contact_mail('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000099'); if n<>1 then raise exception 'mail not claimed'; end if;
 select count(*) into n from public.claim_contact_mail('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000099'); if n<>0 then raise exception 'duplicate lease'; end if;
 update public.contact_mail set first_attempt_at=now()-interval '25 hours',lease_until=now()-interval '1 minute' where dedupe_key='db-test-mail';
 select count(*) into n from public.claim_contact_mail('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000099'); if n<>0 then raise exception 'unsafe late retry'; end if;
 if not exists(select 1 from public.contact_mail where dedupe_key='db-test-mail' and status='manual_review') then raise exception 'late job not flagged';end if;
 if has_table_privilege('anon','public.contact_mail','select') or has_table_privilege('authenticated','public.contact_mail','select') then raise exception 'mail exposed';end if;
 if has_function_privilege('authenticated','public.submit_contact(uuid,text,text,text,uuid,jsonb)','execute') or has_function_privilege('anon','public.claim_contact_mail(uuid,uuid)','execute') then raise exception 'mail RPC exposed';end if;
end $$;
rollback;
