create table public.restaurant_restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.restaurant_categories (
  id text not null check (char_length(id) between 1 and 128),
  restaurant_id uuid not null references public.restaurant_restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '',
  image_url text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, id)
);

create table public.restaurant_menu_items (
  id text not null check (char_length(id) between 1 and 128),
  restaurant_id uuid not null references public.restaurant_restaurants(id) on delete cascade,
  category_id text not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '',
  price_inr numeric(10, 2) not null check (price_inr >= 0),
  image_url text not null default '',
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, id),
  foreign key (restaurant_id, category_id)
    references public.restaurant_categories(restaurant_id, id)
    on delete restrict
);

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurant_restaurants(id) on delete cascade,
  table_number integer not null check (table_number > 0),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  seating_capacity integer not null check (seating_capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, table_number)
);

create table public.restaurant_orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurant_restaurants(id) on delete restrict,
  table_id uuid not null,
  request_id uuid not null,
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 100),
  customer_phone text not null check (char_length(customer_phone) between 7 and 20),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'preparing', 'ready', 'served', 'cancelled')),
  total_inr numeric(14, 2) not null check (total_inr >= 0),
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, request_id),
  foreign key (restaurant_id, table_id)
    references public.restaurant_tables(restaurant_id, id)
    on delete restrict
);

create table public.restaurant_order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  order_id uuid not null,
  menu_item_id text not null,
  item_name text not null check (char_length(btrim(item_name)) between 1 and 160),
  unit_price_inr numeric(10, 2) not null check (unit_price_inr >= 0),
  quantity integer not null check (quantity between 1 and 99),
  line_total_inr numeric(14, 2) not null check (line_total_inr >= 0),
  created_at timestamptz not null default now(),
  unique (order_id, menu_item_id),
  foreign key (restaurant_id, order_id)
    references public.restaurant_orders(restaurant_id, id)
    on delete restrict,
  foreign key (restaurant_id, menu_item_id)
    references public.restaurant_menu_items(restaurant_id, id)
    on delete restrict,
  check (line_total_inr = unit_price_inr * quantity)
);

alter table public.restaurant_restaurants enable row level security;
alter table public.restaurant_categories enable row level security;
alter table public.restaurant_menu_items enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.restaurant_orders enable row level security;
alter table public.restaurant_order_items enable row level security;

revoke all on public.restaurant_restaurants,
  public.restaurant_categories,
  public.restaurant_menu_items,
  public.restaurant_tables,
  public.restaurant_orders,
  public.restaurant_order_items
from anon, authenticated;

create or replace function public.place_restaurant_order(
  p_restaurant_id uuid,
  p_request_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_table_number integer,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_restaurant_id uuid;
  v_table_id uuid;
  v_order_id uuid;
  v_total numeric(14, 2);
  v_item_count integer;
  v_available_count integer;
begin
  if p_restaurant_id is null or p_request_id is null then
    raise exception 'Invalid order request.';
  end if;

  if p_customer_name is null or char_length(btrim(p_customer_name)) not between 1 and 100 then
    raise exception 'Invalid customer name.';
  end if;

  if p_customer_phone is null
    or p_customer_phone !~ '^\+?[0-9][0-9 ()-]{5,18}[0-9]$'
    or char_length(regexp_replace(p_customer_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception 'Invalid phone number.';
  end if;

  if p_table_number is null or p_table_number < 1 then
    raise exception 'Invalid table number.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Invalid order items.';
  end if;

  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Invalid order items.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as line(value)
    where jsonb_typeof(line.value) is distinct from 'object'
      or jsonb_typeof(line.value -> 'itemId') is distinct from 'string'
      or char_length(btrim(line.value ->> 'itemId')) not between 1 and 128
      or jsonb_typeof(line.value -> 'quantity') is distinct from 'number'
      or (line.value ->> 'quantity') !~ '^[1-9][0-9]?$'
  ) then
    raise exception 'Invalid order items.';
  end if;

  select count(*), count(distinct line.value ->> 'itemId')
    into v_item_count, v_available_count
  from jsonb_array_elements(p_items) as line(value);
  if v_item_count <> v_available_count then
    raise exception 'Duplicate order items.';
  end if;

  select order_row.id, order_row.total_inr
    into v_order_id, v_total
  from public.restaurant_orders as order_row
  where order_row.restaurant_id = p_restaurant_id
    and order_row.request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'order_id', v_order_id,
      'total', v_total
    );
  end if;

  select restaurant.id
    into v_restaurant_id
  from public.restaurant_restaurants as restaurant
  where restaurant.id = p_restaurant_id
    and restaurant.is_active
  for share;
  if v_restaurant_id is null then
    raise exception 'Restaurant is unavailable.';
  end if;

  select restaurant_table.id
    into v_table_id
  from public.restaurant_tables as restaurant_table
  where restaurant_table.restaurant_id = p_restaurant_id
    and restaurant_table.table_number = p_table_number
    and restaurant_table.is_active
  for share;
  if v_table_id is null then
    raise exception 'Table is unavailable.';
  end if;

  perform menu_item.id
  from public.restaurant_menu_items as menu_item
  join public.restaurant_categories as category
    on category.restaurant_id = menu_item.restaurant_id
    and category.id = menu_item.category_id
  join jsonb_array_elements(p_items) as line(value)
    on line.value ->> 'itemId' = menu_item.id
  where menu_item.restaurant_id = p_restaurant_id
    and menu_item.is_available
    and category.is_active
  order by menu_item.id
  for share of menu_item, category;

  select count(*)
    into v_available_count
  from public.restaurant_menu_items as menu_item
  join public.restaurant_categories as category
    on category.restaurant_id = menu_item.restaurant_id
    and category.id = menu_item.category_id
  join jsonb_array_elements(p_items) as line(value)
    on line.value ->> 'itemId' = menu_item.id
  where menu_item.restaurant_id = p_restaurant_id
    and menu_item.is_available
    and category.is_active;
  if v_available_count <> v_item_count then
    raise exception 'An item is unavailable.';
  end if;

  select sum(menu_item.price_inr * (line.value ->> 'quantity')::integer)
    into v_total
  from public.restaurant_menu_items as menu_item
  join jsonb_array_elements(p_items) as line(value)
    on line.value ->> 'itemId' = menu_item.id
  where menu_item.restaurant_id = p_restaurant_id;

  insert into public.restaurant_orders (
    restaurant_id,
    table_id,
    request_id,
    customer_name,
    customer_phone,
    total_inr
  )
  values (
    p_restaurant_id,
    v_table_id,
    p_request_id,
    btrim(p_customer_name),
    btrim(p_customer_phone),
    v_total
  )
  on conflict (restaurant_id, request_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select order_row.id, order_row.total_inr
      into v_order_id, v_total
    from public.restaurant_orders as order_row
    where order_row.restaurant_id = p_restaurant_id
      and order_row.request_id = p_request_id;
    return jsonb_build_object(
      'order_id', v_order_id,
      'total', v_total
    );
  end if;

  insert into public.restaurant_order_items (
    restaurant_id,
    order_id,
    menu_item_id,
    item_name,
    unit_price_inr,
    quantity,
    line_total_inr
  )
  select
    menu_item.restaurant_id,
    v_order_id,
    menu_item.id,
    menu_item.name,
    menu_item.price_inr,
    (line.value ->> 'quantity')::integer,
    menu_item.price_inr * (line.value ->> 'quantity')::integer
  from public.restaurant_menu_items as menu_item
  join jsonb_array_elements(p_items) as line(value)
    on line.value ->> 'itemId' = menu_item.id
  where menu_item.restaurant_id = p_restaurant_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'total', v_total
  );
end;
$$;

revoke all on function public.place_restaurant_order(uuid, uuid, text, text, integer, jsonb)
from public, anon, authenticated;
grant execute on function public.place_restaurant_order(uuid, uuid, text, text, integer, jsonb)
to service_role;
