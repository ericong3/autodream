-- Intake checklist for own-stock cars: the physical green card from the
-- previous owner (proof is the existing green_card photo column), and the
-- eAuto ownership-transfer thumbprint from the previous owner, both
-- prepared when the car is taken into stock (not tied to a later sale).
--
-- intake_complete is a separate explicit confirmation: having both the
-- green card and thumbprint done doesn't remove the task by itself, so it
-- can't silently disappear from the checklist — admin has to confirm it.
alter table cars
  add column if not exists thumbprint_done boolean not null default false,
  add column if not exists intake_complete boolean not null default false;
