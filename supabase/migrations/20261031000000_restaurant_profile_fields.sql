alter table public.restaurant_restaurants
  add column cover_image_url text not null default '',
  add column address text not null default '',
  add column phone text not null default '',
  add column opening_hours text not null default '',
  add column currency text not null default 'INR',
  add column google_review_url text not null default '';

alter table public.restaurant_restaurants
  add constraint restaurant_restaurants_address_length_check
    check (char_length(address) <= 250),
  add constraint restaurant_restaurants_phone_format_check
    check (
      phone = ''
      or (
        char_length(phone) between 7 and 30
        and phone ~ '^\+?[0-9][0-9 ()-]{5,28}[0-9]$'
        and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 15
      )
    ),
  add constraint restaurant_restaurants_opening_hours_length_check
    check (char_length(opening_hours) <= 500),
  add constraint restaurant_restaurants_currency_check
    check (currency ~ '^[A-Z]{3}$');
