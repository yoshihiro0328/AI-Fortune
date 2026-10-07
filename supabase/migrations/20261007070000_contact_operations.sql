-- Additive only; existing requests and policies are preserved.
alter table public.contact_messages
  add column first_response_at timestamptz,
  add column replied_at timestamptz,
  add column updated_at timestamptz not null default now();
comment on column public.contact_messages.replied_at is 'Operator-confirmed external reply timestamp; not automatic email delivery evidence.';
