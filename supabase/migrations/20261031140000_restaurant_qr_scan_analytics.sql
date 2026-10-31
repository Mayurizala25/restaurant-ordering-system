create table public.restaurant_qr_scan_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurant_restaurants(id) on delete cascade,
  table_id uuid not null,
  qr_type text not null check (qr_type = 'table_menu'),
  scanned_at timestamptz not null default now(),
  foreign key (restaurant_id, table_id)
    references public.restaurant_tables(restaurant_id, id)
    on delete cascade
);

create index restaurant_qr_scan_events_restaurant_scanned_idx
  on public.restaurant_qr_scan_events (restaurant_id, scanned_at desc);

alter table public.restaurant_qr_scan_events enable row level security;

revoke all on public.restaurant_qr_scan_events
  from public, anon, authenticated;

grant select, insert on public.restaurant_qr_scan_events to service_role;
