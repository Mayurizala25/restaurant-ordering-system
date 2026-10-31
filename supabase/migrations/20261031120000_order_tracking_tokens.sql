alter table public.restaurant_orders
  add column tracking_token_hash text
    check (
      tracking_token_hash is null
      or tracking_token_hash ~ '^[0-9a-f]{64}$'
    );

create unique index restaurant_orders_tracking_token_hash_key
  on public.restaurant_orders (tracking_token_hash)
  where tracking_token_hash is not null;
