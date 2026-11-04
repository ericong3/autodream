-- PREPARED ONLY. Not installed. Install after 20261104110000_investor_money_documents,
-- and only AFTER the private bridge release that serves scope 'investor_claims'
-- (server/usedCar/investorClaims.mjs) is deployed and verified.
-- Staff expense claims on investor-funded cars (repair or misc), kept in a
-- dedicated private table, never in public.payments (the legacy guard already
-- refuses any public payment or journal on an investor car).
--  * submit: the signed-in staff member raises ONE claim and ONE pending car
--    bill atomically. No cash entry, payment, payroll, journal, public repair or
--    public MISC row is written. The bill is created by the claimant, never by an
--    impersonated Director/admin. A settled car takes no new claims.
--  * The claim's money fields are immutable and equal to its bill's. The bill
--    stays canonical: claim state is DERIVED from the bill (pending ->
--    pending, approved -> approved, voided -> rejected), so the existing
--    Director approve_car_bill / void_car_bill paths cannot drift from it.
--  * approve: Director only, through the existing approve_car_bill command under
--    the Director's own identity (supplier-invoice trigger from 090000 applies).
--    Payment is the existing pay_car_bill receipt + cash pipeline, from the
--    investor account; nothing here moves money.
--  * reject: Director or admin, pending claims only, reason required. Voids the
--    pending bill under the reviewer's own identity. No cash, no journal (the
--    journal trigger posts only approved -> voided).
--  * settle_car already refuses pending bills; a settlement trigger below
--    refuses again if any claim bill on the car is still pending.
--  * Reads: claimant reads own claims; Director/admin read all, safe fields
--    only (no account balances, bank details or investor identity). Investors
--    have no claims scope; they see the bill in their existing car snapshot.
--  * Request order: actor role check, actor:request lock, replay check, then the
--    account lock. Identical retries replay; changed retries are refused.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' then
  raise exception 'PRIVATE_FINANCE_RELEASE_NOT_REVIEWED: deploy and verify the private claims bridge before installing';
 end if;
 if to_regprocedure('public.uc_investor_capital_phase4(text,text,jsonb)') is null or to_regclass('public.uc_investor_money_links') is null
  or to_regclass('public.uc_investor_payment_receipts') is null then raise exception 'INVESTOR_MONEY_EVIDENCE_REQUIRED';end if;
 if to_regclass('public.uc_investor_staff_claims') is not null or to_regprocedure('public.uc_investor_claims(text,text,jsonb)') is not null
  or to_regprocedure('public.uc_staff_claim_bill_owned(text,uuid)') is not null then raise exception 'INVESTOR_STAFF_CLAIMS_ALREADY_INSTALLED';end if;
 -- Every public bypass for investor-car costs must already be closed.
 if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled<>'D' and (
   (t.tgrelid='public.payments'::regclass and t.tgname='uc_no_duplicate_payment') or
   (t.tgrelid='public.journal_entries'::regclass and t.tgname='uc_no_duplicate_journal') or
   (t.tgrelid='public.repairs'::regclass and t.tgname='uc_guard_funded_repair') or
   (t.tgrelid='public.cars'::regclass and t.tgname='uc_guard_funded_misc') or
   (t.tgrelid='public.uc_investor_car_bills'::regclass and t.tgname in ('uc_bill_starts_pending','uc_bill_invoice_required','uc_bill_to_journal')) or
   (t.tgrelid='public.uc_investor_cash_entries'::regclass and t.tgname='uc_cash_receipt_required')))<>8 then raise exception 'INVESTOR_SOURCE_GUARDS_REQUIRED';end if;
end $$;

-- ── Claims ───────────────────────────────────────────────────────────────
create table public.uc_investor_staff_claims (
 id uuid primary key default gen_random_uuid(),
 car_id text not null references public.uc_investor_cars(car_id),
 bill_id uuid not null unique references public.uc_investor_car_bills(id),
 claimant_id text not null references public.garage_building_staff(id),
 claim_kind text not null check(claim_kind in ('repair','misc')),
 category text check(category is null or (category=trim(category) and length(category) between 1 and 80 and category !~ '[[:cntrl:]]')),
 purpose text not null check(purpose=trim(purpose) and length(purpose) between 1 and 300 and purpose !~ '[[:cntrl:]]'),
 payee text not null check(payee=trim(payee) and length(payee) between 1 and 150 and payee !~ '[[:cntrl:]]'),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 created_at timestamptz not null default now(),
 unique(claimant_id,request_id)
);
create index uc_staff_claims_recent on public.uc_investor_staff_claims(created_at desc,id desc);
create index uc_staff_claims_claimant on public.uc_investor_staff_claims(claimant_id,created_at desc,id desc);
create index uc_staff_claims_car on public.uc_investor_staff_claims(car_id,created_at desc,id desc);
create trigger uc_staff_claims_fixed before update or delete on public.uc_investor_staff_claims for each row execute function public.uc_investor_immutable();
create trigger uc_staff_claims_no_truncate before truncate on public.uc_investor_staff_claims execute function public.uc_investor_immutable();

-- A claim names exactly the pending bill raised for it, by its claimant.
create function public.uc_staff_claim_link_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare b uc_investor_car_bills; a uc_investor_cars;
begin
 select * into b from uc_investor_car_bills where id=new.bill_id;
 select * into a from uc_investor_cars where car_id=new.car_id;
 if b.id is null or a.car_id is null or a.settled_at is not null or b.car_id<>new.car_id or b.state<>'pending'
  or b.category<>new.claim_kind or b.purpose<>new.purpose or b.payee<>new.payee or b.amount_cents<>new.amount_cents
  or b.created_by<>new.claimant_id then raise exception 'CLAIM_NOT_FOR_BILL';end if;
 return new;
end $$;
create trigger uc_staff_claim_link before insert on public.uc_investor_staff_claims for each row execute function public.uc_staff_claim_link_guard();

-- A claim bill's money and identity never change, it is never deleted, and it
-- moves only pending -> approved, pending -> voided or approved -> voided.
-- Other investor bills are left exactly as before.
create function public.uc_staff_claim_bill_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from uc_investor_staff_claims c where c.bill_id=old.id) then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception 'IMMUTABLE_HISTORY';end if;
 if (to_jsonb(new)-array['state','reviewed_by','reviewed_at','review_note']) is distinct from (to_jsonb(old)-array['state','reviewed_by','reviewed_at','review_note'])
  or not ((old.state='pending' and new.state in ('approved','voided')) or (old.state='approved' and new.state='voided')) then raise exception 'IMMUTABLE_HISTORY';end if;
 return new;
end $$;
create trigger uc_staff_claim_bill_fixed before update or delete on public.uc_investor_car_bills for each row execute function public.uc_staff_claim_bill_guard();

-- Profit is never confirmed over a claim that is still waiting for review.
create function public.uc_staff_claims_settled_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from uc_investor_staff_claims c join uc_investor_car_bills b on b.id=c.bill_id where c.car_id=new.car_id and b.state='pending') then raise exception 'SETTLEMENT_NOT_READY';end if;
 return new;
end $$;
create trigger uc_settlement_claims_reviewed before insert on public.uc_investor_car_settlements for each row execute function public.uc_staff_claims_settled_guard();

-- ── Helpers ──────────────────────────────────────────────────────────────
-- Browser-safe claim shape. No account, balance, bank, investor or storage data.
create function public.uc_investor_claim_view(c public.uc_investor_staff_claims,p_viewer text) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('claimId',c.id,'billId',c.bill_id,'carId',c.car_id,
  'car',jsonb_build_object('make',s.make,'model',s.model,'year',s.year,'plate',s.car_plate),
  'claimKind',c.claim_kind,'category',c.category,'purpose',c.purpose,'payee',c.payee,'amountCents',c.amount_cents,
  'paidCents',coalesce((select -sum(e.amount_cents) from uc_investor_cash_entries e where e.bill_id=b.id and e.kind='car_expense'),0),
  'state',case b.state when 'pending' then 'pending' when 'approved' then 'approved' else 'rejected' end,
  'supplierInvoiceConfirmed',exists(select 1 from uc_investor_documents d where d.bill_id=b.id and d.car_id=c.car_id and d.kind='bill' and d.state='confirmed'),
  'submittedAt',c.created_at,'claimantName',coalesce(nullif(trim(m.name),''),'Staff'),'mine',c.claimant_id=p_viewer,
  'reviewedAt',b.reviewed_at,'reviewNote',case when b.state='voided' then b.review_note end,
  'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.file_name) order by d.confirmed_at,d.id) from uc_investor_documents d where d.bill_id=c.bill_id and d.kind='bill' and d.state='confirmed'),'[]'::jsonb))
 from uc_investor_car_bills b join cars s on s.id=c.car_id left join garage_building_staff m on m.id=c.claimant_id
 where b.id=c.bill_id $$;

-- For the proof wrapper (main): may this active staff member read/upload
-- evidence on this bill because it is their own claim? Not granted to any role;
-- only a reviewed security-definer wrapper calls it.
create function public.uc_staff_claim_bill_owned(p_actor text,p_bill uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(exists(select 1 from garage_building_staff s join uc_investor_staff_claims c on c.claimant_id=s.id
  where s.id=p_actor and c.bill_id=p_bill and s.enabled and s.registration_status='active'
   and s.business_access in ('used_car','both') and s.role in ('director','admin','salesperson','mechanic')),false) $$;

-- ── Command ──────────────────────────────────────────────────────────────
create function public.uc_investor_claims(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; allowed text[]; req text; payload jsonb; prior uc_investor_commands;
 car uc_investor_cars; bill uc_investor_car_bills; claim uc_investor_staff_claims;
 amount bigint; staff_only boolean; page integer:=0; v_state text; v_car text; v_mine boolean:=false;
 car_pending integer; own_pending integer; result jsonb;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 -- Role first, so a replay never outlives a disabled or changed account.
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both')
  and actor.role in ('director','admin','salesperson','mechanic'),false) then raise exception 'NOT_ALLOWED';end if;
 allowed:=case p_action
  when 'submit' then array['carId','claimKind','category','purpose','payee','amountCents','requestId']
  when 'list' then array['page','state','carId','mine']
  when 'details' then array['claimId']
  when 'approve' then array['claimId','requestId']
  when 'reject' then array['claimId','note','requestId'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 if p_action='approve' and actor.role<>'director' then raise exception 'DIRECTOR_APPROVAL_REQUIRED';end if;
 if p_action='reject' and actor.role not in ('director','admin') then raise exception 'NOT_ALLOWED';end if;
 staff_only:=actor.role not in ('director','admin');
 if p_action in ('details','approve','reject') and (jsonb_typeof(p_data->'claimId') is distinct from 'string'
  or p_data->>'claimId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'INVALID';end if;
 if p_data ? 'carId' and (jsonb_typeof(p_data->'carId') is distinct from 'string' or p_data->>'carId' !~ '^[A-Za-z0-9_-]{1,100}$') then raise exception 'INVALID';end if;

 if p_action in ('submit','approve','reject') then
  req:=p_data->>'requestId';
  if jsonb_typeof(p_data->'requestId') is distinct from 'string' or req !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  -- Same lock as every investor money command, taken before any account lock.
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
  payload:=jsonb_build_object('action','claim_'||p_action,'data',p_data);
  select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
  if found then
   if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;
   select * into claim from uc_investor_staff_claims where id=(prior.result->>'claimId')::uuid;
   if claim.id is null then raise exception 'INVALID';end if;
   return jsonb_build_object('claim',uc_investor_claim_view(claim,p_actor),'alreadyRecorded',true);
  end if;
 end if;

 if p_action='submit' then
  if jsonb_typeof(p_data->'claimKind') is distinct from 'string' or p_data->>'claimKind' not in ('repair','misc')
   or jsonb_typeof(p_data->'carId') is distinct from 'string'
   or jsonb_typeof(p_data->'amountCents') is distinct from 'number' or p_data->>'amountCents' !~ '^[1-9][0-9]{0,12}$'
   or jsonb_typeof(p_data->'purpose') is distinct from 'string' or length(trim(p_data->>'purpose')) not between 1 and 300 or p_data->>'purpose' ~ '[[:cntrl:]]'
   or jsonb_typeof(p_data->'payee') is distinct from 'string' or length(trim(p_data->>'payee')) not between 1 and 150 or p_data->>'payee' ~ '[[:cntrl:]]'
   or (p_data ? 'category' and (jsonb_typeof(p_data->'category') is distinct from 'string' or length(trim(p_data->>'category')) not between 1 and 80 or p_data->>'category' ~ '[[:cntrl:]]')) then raise exception 'INVALID';end if;
  amount:=(p_data->>'amountCents')::bigint;
  if amount>1000000000000 then raise exception 'INVALID';end if;
  select * into car from uc_investor_cars where car_id=p_data->>'carId';
  if car.car_id is null then raise exception 'NOT_INVESTOR_FUNDED';end if;
  -- Account lock, then re-read: settle_car takes the same lock first.
  perform 1 from uc_investor_pots where id=car.pot_id for update;
  select * into car from uc_investor_cars where car_id=car.car_id;
  if car.settled_at is not null then raise exception 'CAR_SETTLED_ADJUSTMENT_REQUIRED';end if;
  -- Waiting claims hold up withdrawals and settlement; keep them bounded.
  select count(*) filter(where c.car_id=car.car_id),count(*) filter(where c.claimant_id=p_actor) into car_pending,own_pending
   from uc_investor_staff_claims c join uc_investor_car_bills b on b.id=c.bill_id where b.state='pending' and (c.car_id=car.car_id or c.claimant_id=p_actor);
  if car_pending>=50 or own_pending>=20 then raise exception 'CLAIM_LIMIT';end if;
  insert into uc_investor_car_bills(car_id,category,purpose,payee,amount_cents,created_by)
   values(car.car_id,p_data->>'claimKind',trim(p_data->>'purpose'),trim(p_data->>'payee'),amount,p_actor) returning * into bill;
  insert into uc_investor_staff_claims(car_id,bill_id,claimant_id,claim_kind,category,purpose,payee,amount_cents,request_id)
   values(car.car_id,bill.id,p_actor,bill.category,case when p_data ? 'category' then trim(p_data->>'category') end,bill.purpose,bill.payee,bill.amount_cents,req) returning * into claim;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'claim_submit',
   jsonb_build_object('requestId',req,'carId',car.car_id,'billId',bill.id,'claimId',claim.id,'amountCents',amount));

 elsif p_action='approve' then
  select * into claim from uc_investor_staff_claims where id=(p_data->>'claimId')::uuid;
  if claim.id is null then raise exception 'NOT_ALLOWED';end if;
  -- The existing Director command, as this Director: it takes the account and
  -- bill locks, refuses settled cars and reviewed bills, and the 090000 trigger
  -- requires a confirmed supplier invoice. Derived request ID, as register_car.
  perform uc_investor_capital(p_actor,'approve_car_bill',jsonb_build_object('carId',claim.car_id,'billId',claim.bill_id,'requestId','claim_'||md5(p_actor||':'||req)));
  select * into bill from uc_investor_car_bills where id=claim.bill_id;
  if bill.state<>'approved' then raise exception 'ALREADY_REVIEWED';end if;
  select * into car from uc_investor_cars where car_id=claim.car_id;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'claim_approve',
   jsonb_build_object('requestId',req,'carId',claim.car_id,'billId',claim.bill_id,'claimId',claim.id));

 elsif p_action='reject' then
  if jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 1 and 500 then raise exception 'REASON_REQUIRED';end if;
  select * into claim from uc_investor_staff_claims where id=(p_data->>'claimId')::uuid;
  if claim.id is null then raise exception 'NOT_ALLOWED';end if;
  select * into car from uc_investor_cars where car_id=claim.car_id;
  perform 1 from uc_investor_pots where id=car.pot_id for update;
  select * into bill from uc_investor_car_bills where id=claim.bill_id for update;
  -- Pending only: a pending bill can carry no payment. An approved claim is
  -- corrected by the Director's existing void_car_bill review.
  if bill.state<>'pending' then raise exception 'ALREADY_REVIEWED';end if;
  update uc_investor_car_bills set state='voided',reviewed_by=p_actor,reviewed_at=now(),review_note=trim(p_data->>'note') where id=bill.id;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'claim_reject',
   jsonb_build_object('requestId',req,'carId',claim.car_id,'billId',claim.bill_id,'claimId',claim.id));

 elsif p_action='details' then
  select * into claim from uc_investor_staff_claims where id=(p_data->>'claimId')::uuid and (not staff_only or claimant_id=p_actor);
  -- Missing claims and other people's claims look the same.
  if claim.id is null then raise exception 'NOT_ALLOWED';end if;
  return jsonb_build_object('claim',uc_investor_claim_view(claim,p_actor));

 else
  if p_data ? 'page' then
   if jsonb_typeof(p_data->'page') is distinct from 'number' or p_data->>'page' !~ '^[0-9]{1,4}$' or (p_data->>'page')::integer>1000 then raise exception 'INVALID';end if;
   page:=(p_data->>'page')::integer;
  end if;
  if p_data ? 'state' then
   if jsonb_typeof(p_data->'state') is distinct from 'string' or p_data->>'state' not in ('pending','approved','rejected') then raise exception 'INVALID';end if;
   v_state:=case p_data->>'state' when 'rejected' then 'voided' else p_data->>'state' end;
  end if;
  if p_data ? 'mine' then
   if jsonb_typeof(p_data->'mine') is distinct from 'boolean' then raise exception 'INVALID';end if;
   v_mine:=(p_data->>'mine')::boolean;
  end if;
  v_car:=p_data->>'carId';
  -- Role and filters apply before the page limit. One extra row reports hasMore.
  with page_rows as (
   select c,c.created_at at,c.id cid from uc_investor_staff_claims c join uc_investor_car_bills b on b.id=c.bill_id
   where (not staff_only or c.claimant_id=p_actor) and (not v_mine or c.claimant_id=p_actor)
    and (v_car is null or c.car_id=v_car) and (v_state is null or b.state=v_state)
   order by c.created_at desc,c.id desc limit 51 offset page*50),
  numbered as (select r.c,row_number() over(order by r.at desc,r.cid desc) n from page_rows r)
  select jsonb_build_object('claims',coalesce(jsonb_agg(uc_investor_claim_view(q.c,p_actor) order by q.n) filter(where q.n<=50),'[]'::jsonb),
   'page',page,'hasMore',count(*)>50) into result from numbered q;
  return result;
 end if;

 result:=jsonb_build_object('claimId',claim.id,'billId',claim.bill_id,'carId',claim.car_id);
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,payload,result);
 return jsonb_build_object('claim',uc_investor_claim_view(claim,p_actor),'alreadyRecorded',false);
end $$;

alter table public.uc_investor_staff_claims enable row level security;
revoke all on table public.uc_investor_staff_claims from public,anon,authenticated,service_role;
revoke all on function public.uc_staff_claim_link_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_staff_claim_bill_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_staff_claims_settled_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_claim_view(public.uc_investor_staff_claims,text) from public,anon,authenticated,service_role;
revoke all on function public.uc_staff_claim_bill_owned(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_claims(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_investor_claims(text,text,jsonb) to service_role;
commit;
