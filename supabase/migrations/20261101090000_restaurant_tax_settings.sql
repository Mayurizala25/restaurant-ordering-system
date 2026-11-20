alter table public.restaurant_restaurants
  add column tax_rate_percent numeric(5, 2) not null default 0
    check (tax_rate_percent between 0 and 100);

alter table public.restaurant_orders
  add column tax_rate_percent numeric(5, 2) not null default 0
    check (tax_rate_percent between 0 and 100),
  add column tax_amount_inr numeric(14, 2) not null default 0
    check (tax_amount_inr >= 0 and tax_amount_inr <= total_inr);

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
  v_subtotal numeric(14, 2);
  v_tax_rate_percent numeric(5, 2);
  v_tax_amount numeric(14, 2);
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
      or (line.value ? 'spiceLevel'
        and (jsonb_typeof(line.value -> 'spiceLevel') is distinct from 'string'
          or line.value ->> 'spiceLevel' not in ('Mild', 'Medium', 'Spicy')))
      or (line.value ? 'specialInstructions'
        and (jsonb_typeof(line.value -> 'specialInstructions') is distinct from 'string'
          or char_length(line.value ->> 'specialInstructions') > 500))
  ) then
    raise exception 'Invalid order items.';
  end if;

  select count(*), count(distinct line.value ->> 'itemId')
    into v_item_count, v_available_count
  from jsonb_array_elements(p_items) as line(value);
  if v_item_count <> v_available_count then
    raise exception 'Duplicate order items.';
  end if;

  select
    order_row.id,
    order_row.total_inr,
    order_row.tax_rate_percent,
    order_row.tax_amount_inr
    into v_order_id, v_total, v_tax_rate_percent, v_tax_amount
  from public.restaurant_orders as order_row
  where order_row.restaurant_id = p_restaurant_id
    and order_row.request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'order_id', v_order_id,
      'subtotal', v_total - v_tax_amount,
      'tax_rate_percent', v_tax_rate_percent,
      'tax_amount', v_tax_amount,
      'total', v_total
    );
  end if;

  select restaurant.id, restaurant.tax_rate_percent
    into v_restaurant_id, v_tax_rate_percent
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
    into v_subtotal
  from public.restaurant_menu_items as menu_item
  join jsonb_array_elements(p_items) as line(value)
    on line.value ->> 'itemId' = menu_item.id
  where menu_item.restaurant_id = p_restaurant_id;

  v_tax_amount := round(v_subtotal * v_tax_rate_percent / 100, 2);
  v_total := v_subtotal + v_tax_amount;

  insert into public.restaurant_orders (
    restaurant_id,
    table_id,
    request_id,
    customer_name,
    customer_phone,
    total_inr,
    tax_rate_percent,
    tax_amount_inr
  )
  values (
    p_restaurant_id,
    v_table_id,
    p_request_id,
    btrim(p_customer_name),
    btrim(p_customer_phone),
    v_total,
    v_tax_rate_percent,
    v_tax_amount
  )
  on conflict (restaurant_id, request_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select
      order_row.id,
      order_row.total_inr,
      order_row.tax_rate_percent,
      order_row.tax_amount_inr
      into v_order_id, v_total, v_tax_rate_percent, v_tax_amount
    from public.restaurant_orders as order_row
    where order_row.restaurant_id = p_restaurant_id
      and order_row.request_id = p_request_id;
    return jsonb_build_object(
      'order_id', v_order_id,
      'subtotal', v_total - v_tax_amount,
      'tax_rate_percent', v_tax_rate_percent,
      'tax_amount', v_tax_amount,
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
    line_total_inr,
    spice_level,
    special_instructions
  )
  select
    menu_item.restaurant_id,
    v_order_id,
    menu_item.id,
    menu_item.name,
    menu_item.price_inr,
    (line.value ->> 'quantity')::integer,
    menu_item.price_inr * (line.value ->> 'quantity')::integer,
    coalesce(line.value ->> 'spiceLevel', 'Mild'),
    coalesce(line.value ->> 'specialInstructions', '')
  from public.restaurant_menu_items as menu_item
  join jsonb_array_elements(p_items) as line(value)
    on line.value ->> 'itemId' = menu_item.id
  where menu_item.restaurant_id = p_restaurant_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'subtotal', v_subtotal,
    'tax_rate_percent', v_tax_rate_percent,
    'tax_amount', v_tax_amount,
    'total', v_total
  );
end;
$$;
