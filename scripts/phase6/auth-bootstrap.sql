-- Local synthetic platform fixture only. Never run against a hosted project.
create schema auth;
grant usage on schema auth to postgres,supabase_auth_admin;
create table auth.users(id uuid primary key, created_at timestamptz default now(), email_confirmed_at timestamptz);
alter table auth.users owner to supabase_auth_admin;
alter table auth.users enable row level security;
revoke all on auth.users from public,anon,authenticated,service_role;
-- Platform owner administers fixtures; the application role never reads Auth rows.
grant all on auth.users to postgres;
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
-- Match the review project's auto-exposure-OFF behavior; migrations grant access explicitly.
alter default privileges for role postgres in schema public revoke all on tables from anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public,anon,authenticated,service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon,authenticated,service_role;
