-- Mix & Match pricing turns out to be per-piece by series only (no size
-- dimension) — real price list only breaks down by series x glass
-- position. Table is still empty (nothing seeded until now), so this is a
-- safe schema correction rather than a data migration.
alter table garage_tint_position_prices drop constraint garage_tint_position_prices_pkey;
alter table garage_tint_position_prices drop column vehicle_size;
alter table garage_tint_position_prices add primary key (glass_position, series);

-- Full package's chosen VLT (one for the whole car) and the optional
-- add-ons (extra rear window / small window) picked alongside either
-- package type.
alter table garage_tint_orders
  add column if not exists full_vlt text,
  add column if not exists extras jsonb not null default '[]'::jsonb;

-- Seed the real price list.
insert into garage_tint_full_prices (series, vehicle_size, price) values
  ('royal', 'standard', 3899), ('royal', 'large', 4099), ('royal', 'xlarge', 4299),
  ('unique', 'standard', 3399), ('unique', 'large', 3599), ('unique', 'xlarge', 3799),
  ('majestic', 'standard', 2699), ('majestic', 'large', 2899), ('majestic', 'xlarge', 3099),
  ('classic', 'standard', 2199), ('classic', 'large', 2499), ('classic', 'xlarge', 2799),
  ('lite', 'standard', 1499), ('lite', 'large', 1799), ('lite', 'xlarge', 1999),
  ('eco', 'standard', 699), ('eco', 'large', 799), ('eco', 'xlarge', 899)
on conflict (series, vehicle_size) do update set price = excluded.price, updated_at = now();

insert into garage_tint_position_prices (glass_position, series, price) values
  ('front_windscreen', 'royal', 750), ('door_window', 'royal', 650), ('rear_panel_window', 'royal', 520), ('rear_windscreen', 'royal', 750),
  ('front_windscreen', 'unique', 680), ('door_window', 'unique', 550), ('rear_panel_window', 'unique', 420), ('rear_windscreen', 'unique', 680),
  ('front_windscreen', 'majestic', 530), ('door_window', 'majestic', 450), ('rear_panel_window', 'majestic', 350), ('rear_windscreen', 'majestic', 530),
  ('front_windscreen', 'classic', 480), ('door_window', 'classic', 350), ('rear_panel_window', 'classic', 250), ('rear_windscreen', 'classic', 480),
  ('front_windscreen', 'lite', 380), ('door_window', 'lite', 200), ('rear_panel_window', 'lite', 150), ('rear_windscreen', 'lite', 380),
  ('front_windscreen', 'eco', 250), ('door_window', 'eco', 80), ('rear_panel_window', 'eco', 80), ('rear_windscreen', 'eco', 250)
on conflict (glass_position, series) do update set price = excluded.price, updated_at = now();
