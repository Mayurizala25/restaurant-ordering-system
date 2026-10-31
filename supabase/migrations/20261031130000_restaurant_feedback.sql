create table public.restaurant_feedback (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    references public.restaurant_restaurants(id) on delete cascade,
  order_id uuid not null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (restaurant_id, order_id),
  foreign key (restaurant_id, order_id)
    references public.restaurant_orders(restaurant_id, id)
    on delete cascade
);

create index restaurant_feedback_restaurant_created_idx
  on public.restaurant_feedback (restaurant_id, created_at desc);

alter table public.restaurant_feedback enable row level security;

revoke all on public.restaurant_feedback
  from public, anon, authenticated;

grant select, insert, update on public.restaurant_feedback to service_role;
