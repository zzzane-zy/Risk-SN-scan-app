create table if not exists public.scan_events (
  id bigserial primary key,
  event_id text not null unique,
  sn text not null,
  result text not null check (result in ('risk', 'safe')),
  warehouse_code text not null,
  device_id text not null,
  operator_name text,
  scan_source text,
  app_version text,
  is_test boolean not null default false,
  test_tag text,
  scanned_at timestamptz not null,
  received_at timestamptz not null default now(),
  raw_payload jsonb
);

alter table public.scan_events
  add column if not exists is_test boolean not null default false;

alter table public.scan_events
  add column if not exists test_tag text;

create index if not exists scan_events_sn_idx
  on public.scan_events (sn);

create index if not exists scan_events_warehouse_time_idx
  on public.scan_events (warehouse_code, scanned_at desc);

create index if not exists scan_events_received_at_idx
  on public.scan_events (received_at desc);

alter table public.scan_events enable row level security;

grant usage on schema public to anon;
grant insert on table public.scan_events to anon;
grant usage, select on sequence public.scan_events_id_seq to anon;

drop policy if exists "Allow app inserts scan events" on public.scan_events;

create policy "Allow app inserts scan events"
  on public.scan_events
  for insert
  to anon
  with check (
    sn ~ '^P[0-9A-Z]{22}$'
    and warehouse_code <> ''
    and device_id <> ''
    and (test_tag is null or test_tag = 'test')
  );
