-- car_in_date was only ever written by the "Car In" button on Coming Soon
-- cars, so every car added directly as Available/etc. was silently missing
-- it — and sourcing/intake commission (keyed off car_in_date everywhere it's
-- calculated: Commission, SalesDashboard, Payroll) never showed up for them.
-- Backfill from date_added for every car that has actually arrived.
update cars
set car_in_date = date_added
where car_in_date is null
  and status <> 'coming_soon';
