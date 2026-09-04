-- Salesman-initiated "send to workshop" flow: track who sent the car and
-- their quick pickup snapshot of the physical bill (backup only — admin
-- keys in the official bill separately once status hits 'awaiting_bill').
alter table repairs
  add column if not exists sent_by text,
  add column if not exists collected_at timestamptz,
  add column if not exists collected_photo text;
