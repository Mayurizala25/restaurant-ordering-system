create schema if not exists private;

revoke all on schema private from public, anon, authenticated, service_role;

create table private.admin_login_attempts (
  identifier_hash text primary key
    check (identifier_hash ~ '^[0-9a-f]{64}$'),
  attempts timestamptz[] not null,
  last_attempt_at timestamptz not null
);

create index admin_login_attempts_last_attempt_idx
  on private.admin_login_attempts (last_attempt_at);

create table private.admin_revoked_sessions (
  token_hash text primary key
    check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);

create index admin_revoked_sessions_expires_idx
  on private.admin_revoked_sessions (expires_at);

alter table private.admin_login_attempts enable row level security;
alter table private.admin_revoked_sessions enable row level security;

revoke all on private.admin_login_attempts,
  private.admin_revoked_sessions
from public, anon, authenticated, service_role;

create or replace function public.consume_admin_login_attempt(
  p_identifier_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, private
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_attempts timestamptz[];
  v_reset_at timestamptz;
  v_allowed boolean;
begin
  if p_identifier_hash is null
    or p_identifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid login limiter identifier.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_identifier_hash, 0));

  with expired_attempts as (
    select identifier_hash
      from private.admin_login_attempts
      where last_attempt_at <= v_now - interval '15 minutes'
      order by last_attempt_at
      limit 100
      for update skip locked
  )
  delete from private.admin_login_attempts as attempts
    using expired_attempts
    where attempts.identifier_hash = expired_attempts.identifier_hash;

  select attempts
    into v_attempts
    from private.admin_login_attempts
    where identifier_hash = p_identifier_hash
    for update;

  select coalesce(
      array_agg(attempt_at order by attempt_at),
      array[]::timestamptz[]
    )
    into v_attempts
    from unnest(coalesce(v_attempts, array[]::timestamptz[]))
      as attempt(attempt_at)
    where attempt.attempt_at > v_now - interval '15 minutes';

  v_allowed := cardinality(v_attempts) < 5;
  v_reset_at := coalesce(
    v_attempts[1] + interval '15 minutes',
    v_now + interval '15 minutes'
  );

  if v_allowed then
    v_attempts := array_append(v_attempts, v_now);
    insert into private.admin_login_attempts (
      identifier_hash,
      attempts,
      last_attempt_at
    )
    values (p_identifier_hash, v_attempts, v_now)
    on conflict (identifier_hash) do update
      set attempts = excluded.attempts,
          last_attempt_at = excluded.last_attempt_at;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reset_at', floor(extract(epoch from v_reset_at) * 1000)::bigint
  );
end;
$$;

create or replace function public.is_admin_session_revoked(
  p_token_hash text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, private
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid admin session identifier.';
  end if;

  with expired_sessions as (
    select token_hash
      from private.admin_revoked_sessions
      where expires_at <= clock_timestamp()
      order by expires_at
      limit 100
      for update skip locked
  )
  delete from private.admin_revoked_sessions as sessions
    using expired_sessions
    where sessions.token_hash = expired_sessions.token_hash;

  return exists (
    select 1
      from private.admin_revoked_sessions
      where token_hash = p_token_hash
  );
end;
$$;

create or replace function public.revoke_admin_session(
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, private
as $$
begin
  if p_token_hash is null
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at is null
    or p_expires_at <= clock_timestamp() then
    raise exception 'Invalid admin session revocation.';
  end if;

  insert into private.admin_revoked_sessions (token_hash, expires_at)
  values (p_token_hash, p_expires_at)
  on conflict (token_hash) do update
    set expires_at = greatest(
      private.admin_revoked_sessions.expires_at,
      excluded.expires_at
    );

  return true;
end;
$$;

revoke all on function public.consume_admin_login_attempt(text)
  from public, anon, authenticated, service_role;
revoke all on function public.is_admin_session_revoked(text)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_admin_session(text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.consume_admin_login_attempt(text)
  to service_role;
grant execute on function public.is_admin_session_revoked(text)
  to service_role;
grant execute on function public.revoke_admin_session(text, timestamptz)
  to service_role;
