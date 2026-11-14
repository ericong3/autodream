-- One-time merge (2026-11-14): dealer "Topmark" becomes "2TN". Topmark is removed.
--   Topmark dealer id 1782957129282-l6ijrgxqs  ->  2TN dealer id 1782957135678-e87jax4fy
--
-- What it changes (expected counts from the 14 Nov preflight):
--   cars           56  consignment dealer Topmark -> 2TN
--   payments       17  consignment payouts: recipient -> 2TN (3 paid + 14 unpaid)
--                      the 14 UNPAID payouts also get 2TN's bank details (Topmark had none)
--   car_movements  78  "moved to dealer Topmark" -> "2TN"
--   dealers         1  Topmark profile deleted
-- Left as written history (free text): car movement notes, notifications,
-- a customer follow-up remark.
--
-- Single statement = all or nothing. If any safety rule refuses a row,
-- the whole merge is cancelled and nothing changes.
-- Expected result: one row -> 56 | 17 | 14 | 78 | 1
with
src as (select id from dealers where id = '1782957129282-l6ijrgxqs' and name ilike 'topmark'),
dst as (select id, name, bank_name, bank_account_number, bank_account_holder
        from dealers where id = '1782957135678-e87jax4fy' and name = '2TN'
          and exists (select 1 from src)
          and not exists (select 1 from uc_consignment_cases k join cars c on c.id = k.car_id
                          where c.consignment->>'dealer' ilike 'topmark')),
car_upd as (
  update cars c set consignment = jsonb_set(c.consignment, '{dealer}', to_jsonb((select name from dst)))
  where c.consignment->>'dealer' ilike 'topmark' and exists (select 1 from dst)
  returning 1),
pay_upd as (
  update payments p set
    recipient_id   = (select id from dst),
    recipient_name = (select name from dst),
    bank_name      = case when p.status = 'pending' and coalesce(p.bank_name,'') = ''      then (select bank_name from dst)           else p.bank_name end,
    account_number = case when p.status = 'pending' and coalesce(p.account_number,'') = '' then (select bank_account_number from dst) else p.account_number end,
    account_holder = case when p.status = 'pending' and coalesce(p.account_holder,'') = '' then (select bank_account_holder from dst) else p.account_holder end
  where p.type = 'consignment_payout'
    and (p.recipient_id = '1782957129282-l6ijrgxqs' or p.recipient_name ilike 'topmark')
    and exists (select 1 from dst)
  returning p.status),
mov_upd as (
  update car_movements m set destination_name = (select name from dst)
  where m.destination_type = 'dealer' and m.destination_name ilike 'topmark' and exists (select 1 from dst)
  returning 1),
dealer_del as (
  delete from dealers where id in (select id from src) and exists (select 1 from dst)
  returning 1)
select (select count(*) from car_upd)                              as cars_moved,
       (select count(*) from pay_upd)                              as payouts_moved,
       (select count(*) from pay_upd where status = 'pending')     as unpaid_with_2tn_bank,
       (select count(*) from mov_upd)                              as movements_moved,
       (select count(*) from dealer_del)                           as topmark_deleted;
