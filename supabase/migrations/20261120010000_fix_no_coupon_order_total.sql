create or replace function public.place_restaurant_order(
  p_restaurant_id uuid,
  p_request_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_table_number integer,
  p_items jsonb,
  p_coupon_code text default null
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
  v_discount numeric(14, 2) := 0;
  v_taxable numeric(14, 2);
  v_tax_rate numeric(5, 2);
  v_tax_amount numeric(14, 2);
  v_total numeric(14, 2);
  v_coupon_id uuid;
  v_coupon_code text;
  v_validation jsonb;
  v_item_count integer;
  v_available_count integer;
begin
  if p_restaurant_id is null or p_request_id is null then raise exception 'Invalid order request.'; end if;
  if p_customer_name is null or char_length(btrim(p_customer_name)) not between 1 and 100 then raise exception 'Invalid customer name.'; end if;
  if p_customer_phone is null or char_length(regexp_replace(p_customer_phone, '[^0-9]', '', 'g')) not between 7 and 15 then raise exception 'Invalid phone number.'; end if;
  if p_table_number is null or p_table_number < 1 then raise exception 'Invalid table number.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Invalid order items.'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) line(value)
    where jsonb_typeof(line.value) is distinct from 'object'
      or jsonb_typeof(line.value -> 'itemId') is distinct from 'string'
      or char_length(btrim(line.value ->> 'itemId')) not between 1 and 128
      or jsonb_typeof(line.value -> 'quantity') is distinct from 'number'
      or (line.value ->> 'quantity') !~ '^[1-9][0-9]?$'
  ) then raise exception 'Invalid order items.'; end if;

  select count(*), count(distinct line.value ->> 'itemId')
    into v_item_count, v_available_count
  from jsonb_array_elements(p_items) line(value);
  if v_item_count <> v_available_count then raise exception 'Duplicate order items.'; end if;

  select order_row.id, order_row.total_inr, order_row.tax_rate_percent,
         order_row.tax_amount_inr, order_row.coupon_discount_inr,
         order_row.coupon_id, order_row.coupon_code
    into v_order_id, v_total, v_tax_rate, v_tax_amount, v_discount,
         v_coupon_id, v_coupon_code
  from public.restaurant_orders order_row
  where order_row.restaurant_id = p_restaurant_id and order_row.request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'order_id', v_order_id,
      'subtotal', v_total - v_tax_amount + v_discount,
      'discount_amount', v_discount,
      'coupon_code', v_coupon_code,
      'coupon_id', v_coupon_id,
      'tax_rate_percent', v_tax_rate,
      'tax_amount', v_tax_amount,
      'total', v_total
    );
  end if;

  v_discount := 0;

  select restaurant.id, restaurant.tax_rate_percent
    into v_restaurant_id, v_tax_rate
  from public.restaurant_restaurants restaurant
  where restaurant.id = p_restaurant_id and restaurant.is_active
  for share;
  if v_restaurant_id is null then raise exception 'Restaurant is unavailable.'; end if;

  select restaurant_table.id into v_table_id
  from public.restaurant_tables restaurant_table
  where restaurant_table.restaurant_id = p_restaurant_id
    and restaurant_table.table_number = p_table_number
    and restaurant_table.is_active
  for share;
  if v_table_id is null then raise exception 'Table is unavailable.'; end if;

  select count(*)
    into v_available_count
  from public.restaurant_menu_items menu_item
  join public.restaurant_categories category
    on category.restaurant_id = menu_item.restaurant_id and category.id = menu_item.category_id
  join jsonb_array_elements(p_items) line(value)
    on line.value ->> 'itemId' = menu_item.id
  where menu_item.restaurant_id = p_restaurant_id
    and menu_item.is_available and category.is_active;
  if v_available_count <> v_item_count then raise exception 'An item is unavailable.'; end if;

  select sum(menu_item.price_inr * (line.value ->> 'quantity')::integer)
    into v_subtotal
  from public.restaurant_menu_items menu_item
  join jsonb_array_elements(p_items) line(value)
    on line.value ->> 'itemId' = menu_item.id
  where menu_item.restaurant_id = p_restaurant_id;

  if p_coupon_code is not null and btrim(p_coupon_code) <> '' then
    v_validation := public.validate_restaurant_coupon(p_restaurant_id, p_coupon_code, v_subtotal);
    v_coupon_id := (v_validation ->> 'coupon_id')::uuid;
    v_coupon_code := v_validation ->> 'coupon_code';
    v_discount := (v_validation ->> 'discount_amount')::numeric;

    update public.restaurant_coupons
    set used_count = used_count + 1, updated_at = now()
    where id = v_coupon_id
      and is_active
      and (expiry_date is null or expiry_date >= current_date)
      and (usage_limit is null or used_count < usage_limit)
    returning id into v_coupon_id;
    if v_coupon_id is null then raise exception 'Coupon could not be applied.'; end if;
  end if;

  v_taxable := round(v_subtotal - v_discount, 2);
  v_tax_amount := round(v_taxable * v_tax_rate / 100, 2);
  v_total := round(v_taxable + v_tax_amount, 2);

  insert into public.restaurant_orders (
    restaurant_id, table_id, request_id, customer_name, customer_phone,
    total_inr, tax_rate_percent, tax_amount_inr,
    coupon_id, coupon_code, coupon_discount_inr
  ) values (
    p_restaurant_id, v_table_id, p_request_id, btrim(p_customer_name), btrim(p_customer_phone),
    v_total, v_tax_rate, v_tax_amount,
    v_coupon_id, v_coupon_code, v_discount
  ) on conflict (restaurant_id, request_id) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select order_row.id, order_row.total_inr, order_row.tax_rate_percent,
           order_row.tax_amount_inr, order_row.coupon_discount_inr,
           order_row.coupon_id, order_row.coupon_code
      into v_order_id, v_total, v_tax_rate, v_tax_amount, v_discount,
           v_coupon_id, v_coupon_code
    from public.restaurant_orders order_row
    where order_row.restaurant_id = p_restaurant_id and order_row.request_id = p_request_id;
  else
    insert into public.restaurant_order_items (
      restaurant_id, order_id, menu_item_id, item_name, unit_price_inr,
      quantity, line_total_inr, spice_level, special_instructions
    )
    select menu_item.restaurant_id, v_order_id, menu_item.id, menu_item.name,
           menu_item.price_inr, (line.value ->> 'quantity')::integer,
           menu_item.price_inr * (line.value ->> 'quantity')::integer,
           coalesce(line.value ->> 'spiceLevel', 'Mild'),
           coalesce(line.value ->> 'specialInstructions', '')
    from public.restaurant_menu_items menu_item
    join jsonb_array_elements(p_items) line(value)
      on line.value ->> 'itemId' = menu_item.id
    where menu_item.restaurant_id = p_restaurant_id;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'coupon_code', v_coupon_code,
    'coupon_id', v_coupon_id,
    'tax_rate_percent', v_tax_rate,
    'tax_amount', v_tax_amount,
    'total', v_total
  );
end;
$$;
