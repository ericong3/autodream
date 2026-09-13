-- Adds the Used Car / Garage business-access flag to users, ahead of the
-- Garage business being built out. Purely additive: existing rows keep
-- working exactly as before (everyone defaults to 'used_car'), directors and
-- shareholders get 'both' since they need to see both businesses.
alter table users add column if not exists business_access text not null default 'used_car';

update users set business_access = 'both' where role in ('director', 'shareholder');
