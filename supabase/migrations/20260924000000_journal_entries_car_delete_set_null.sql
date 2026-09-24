-- journal_entries.car_id had no ON DELETE behavior, which defaults to
-- RESTRICT — since almost every car gets a purchase journal entry the
-- moment it's added (see buildCarPurchaseEntry), this silently blocked
-- deleting ANY car that had ever had money booked against it. Entries are
-- never hard-deleted (voided/voided_by is the correction trail — see
-- 20260720_journal_entries.sql), so detaching the car reference on delete
-- is safe: the ledger row and its history stay intact, it just stops
-- pointing at a car that no longer exists. Matches the same on delete set
-- null already used for trade_in_source_car_id.
alter table journal_entries drop constraint if exists journal_entries_car_id_fkey;
alter table journal_entries
  add constraint journal_entries_car_id_fkey
  foreign key (car_id) references cars(id) on delete set null;
