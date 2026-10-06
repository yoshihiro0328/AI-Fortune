create index diagnoses_type_idx on public.diagnoses(diagnosis_type_id);
create index answers_question_idx on public.diagnosis_answers(question_id);
create index affiliate_rec_diagnosis_idx on public.affiliate_recommendations(diagnosis_id);
create index affiliate_rec_product_idx on public.affiliate_recommendations(affiliate_product_id);
create index affiliate_click_user_idx on public.affiliate_clicks(user_id);
create index affiliate_click_diagnosis_idx on public.affiliate_clicks(diagnosis_id);
create index affiliate_click_product_idx on public.affiliate_clicks(affiliate_product_id);
create index analytics_user_idx on public.analytics_events(user_id);
