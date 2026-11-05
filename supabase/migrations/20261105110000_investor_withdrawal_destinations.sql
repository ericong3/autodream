-- PREPARED ONLY. Not installed. Director-confirmed payout destination for
-- investor withdrawals. Install after every prepared investor migration
-- (through 20261105060000 for uc_investor_capital, and after
-- 20261104110000 money evidence), and only together with the bridge and
-- console release that sends the destination fields.
--  * approve_withdrawal must carry the investor's bank, account holder and
--    account number, typed by the Director and confirmed by them
--    (destinationConfirmed=true). The destination is stored in the same
--    transaction as the approval and can never be changed or deleted. Profile
--    or staff bank details are never read, so editing them later cannot
--    reroute an approved payout.
--  * withdrawal_paid must name that destination (destinationId) and still
--    needs the confirmed payment receipt (20261104110000). A trigger refuses
--    any withdrawal_out cash row without a destination, and a deferred check
--    refuses one left without its payout link at commit.
--  * confirm_withdrawal_destination is a one-time Director setup step for a
--    withdrawal approved before this migration. Nothing is guessed.
--  * The investor reads their own destination and withdrawal history in
--    snapshot. Admin and other staff are refused. No bank movement is created.
begin;
do $$ begin
 if current_setting('autodream.private_finance_ready',true) is distinct from 'reviewed-20261104' then raise exception 'PRIVATE_FINANCE_RELEASE_NOT_REVIEWED';end if;
 if to_regclass('public.uc_investor_money_links') is null or to_regprocedure('public.uc_capital_before_company_trade_ins(text,text,jsonb)') is null then raise exception 'INVESTOR_FINANCE_CHAIN_REQUIRED';end if;
 if to_regclass('public.uc_investor_withdrawal_destinations') is not null or to_regprocedure('public.uc_capital_before_withdrawal_destinations(text,text,jsonb)') is not null then raise exception 'WITHDRAWAL_DESTINATIONS_ALREADY_INSTALLED';end if;
end $$;

create table public.uc_investor_withdrawal_destinations (
 id uuid primary key default gen_random_uuid(),
 withdrawal_id uuid not null unique references public.uc_investor_withdrawals(id),
 pot_id uuid not null references public.uc_investor_pots(id),
 bank_name text not null check(bank_name=trim(bank_name) and length(bank_name) between 2 and 80 and bank_name !~ '[[:cntrl:]]'),
 account_holder text not null check(account_holder=trim(account_holder) and length(account_holder) between 2 and 150 and account_holder !~ '[[:cntrl:]]'),
 account_number text not null check(account_number ~ '^[0-9]{6,20}$'),
 confirmed_by text not null references public.garage_building_staff(id),
 confirmed_at timestamptz not null default now(),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 -- The destination fields exactly as sent, so a retry must repeat them.
 extra jsonb not null check(jsonb_typeof(extra)='object'),
 unique(confirmed_by,request_id)
);
create index uc_withdrawal_destinations_pot on public.uc_investor_withdrawal_destinations(pot_id,confirmed_at);
-- One payout pays one withdrawal to its one destination.
create table public.uc_investor_withdrawal_payouts (
 entry_id uuid primary key references public.uc_investor_cash_entries(id),
 withdrawal_id uuid not null unique references public.uc_investor_withdrawals(id),
 destination_id uuid not null unique references public.uc_investor_withdrawal_destinations(id),
 actor_id text not null references public.garage_building_staff(id),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),
 created_at timestamptz not null default now(),
 unique(actor_id,request_id)
);
create trigger uc_withdrawal_destinations_fixed before update or delete on public.uc_investor_withdrawal_destinations for each row execute function public.uc_investor_immutable();
create trigger uc_withdrawal_destinations_no_truncate before truncate on public.uc_investor_withdrawal_destinations execute function public.uc_investor_immutable();
create trigger uc_withdrawal_payouts_fixed before update or delete on public.uc_investor_withdrawal_payouts for each row execute function public.uc_investor_immutable();
create trigger uc_withdrawal_payouts_no_truncate before truncate on public.uc_investor_withdrawal_payouts execute function public.uc_investor_immutable();

-- A destination belongs to an approved withdrawal of the same account.
create function public.uc_withdrawal_destination_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare w uc_investor_withdrawals;
begin
 select * into w from uc_investor_withdrawals where id=new.withdrawal_id;
 if w.id is null or w.pot_id<>new.pot_id or w.state<>'approved' then raise exception 'APPROVAL_REQUIRED';end if;
 return new;
end $$;
create trigger uc_withdrawal_destination_check before insert on public.uc_investor_withdrawal_destinations for each row execute function public.uc_withdrawal_destination_guard();
-- The payout link must match its cash row and that withdrawal's destination.
create function public.uc_withdrawal_payout_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from uc_investor_cash_entries e join uc_investor_withdrawal_destinations d on d.withdrawal_id=e.withdrawal_id
  where e.id=new.entry_id and e.kind='withdrawal_out' and e.withdrawal_id=new.withdrawal_id and d.id=new.destination_id) then raise exception 'DESTINATION_CHANGED';end if;
 return new;
end $$;
create trigger uc_withdrawal_payout_check before insert on public.uc_investor_withdrawal_payouts for each row execute function public.uc_withdrawal_payout_guard();

-- Every path: no payout without a confirmed destination...
create function public.uc_require_withdrawal_destination() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from uc_investor_withdrawal_destinations where withdrawal_id=new.withdrawal_id) then raise exception 'DESTINATION_REQUIRED';end if;
 return new;
end $$;
create trigger uc_cash_withdrawal_destination before insert on public.uc_investor_cash_entries for each row
 when (new.kind='withdrawal_out') execute function public.uc_require_withdrawal_destination();
-- ...and the payout row must carry its destination link by commit.
create function public.uc_withdrawal_payout_linked() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from uc_investor_withdrawal_payouts where entry_id=new.id) then raise exception 'DESTINATION_REQUIRED';end if;
 return null;
end $$;
create constraint trigger uc_cash_withdrawal_payout_linked after insert on public.uc_investor_cash_entries deferrable initially deferred for each row
 when (new.kind='withdrawal_out') execute function public.uc_withdrawal_payout_linked();
-- No approval from here on is left without a destination at commit.
create function public.uc_withdrawal_approval_has_destination() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from uc_investor_withdrawal_destinations where withdrawal_id=new.id) then raise exception 'DESTINATION_REQUIRED';end if;
 return null;
end $$;
create constraint trigger uc_withdrawal_approval_destination after update on public.uc_investor_withdrawals deferrable initially deferred for each row
 when (old.state='requested' and new.state='approved') execute function public.uc_withdrawal_approval_has_destination();

-- Browser-safe shape. Shown only to the Director and the account's own investor.
create function public.uc_withdrawal_destination_view(d public.uc_investor_withdrawal_destinations) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('destinationId',d.id,'withdrawalId',d.withdrawal_id,'bankName',d.bank_name,'accountHolder',d.account_holder,'accountNumber',d.account_number,
  'confirmedAt',d.confirmed_at,'confirmedBy',coalesce((select nullif(trim(s.name),'') from garage_building_staff s where s.id=d.confirmed_by),'Director'),
  'paidEntryId',(select p.entry_id from uc_investor_withdrawal_payouts p where p.destination_id=d.id)) $$;

-- Validates the four destination fields; returns the stored values.
create function public.uc_withdrawal_destination_input(p_data jsonb) returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare bank text; holder text; account text;
begin
 if exists(select 1 from unnest(array['destinationBank','destinationHolder','destinationAccount']) k where jsonb_typeof(p_data->k) is distinct from 'string') then raise exception 'DESTINATION_REQUIRED';end if;
 if p_data->'destinationConfirmed' is distinct from 'true'::jsonb then raise exception 'DESTINATION_NOT_CONFIRMED';end if;
 bank:=regexp_replace(trim(p_data->>'destinationBank'),'\s+',' ','g');
 holder:=regexp_replace(trim(p_data->>'destinationHolder'),'\s+',' ','g');
 if p_data->>'destinationAccount' !~ '^[0-9 -]{6,40}$' then raise exception 'DESTINATION_INVALID';end if;
 account:=regexp_replace(p_data->>'destinationAccount','[ -]','','g');
 if length(bank) not between 2 and 80 or bank ~ '[[:cntrl:]]' or length(holder) not between 2 and 150 or holder ~ '[[:cntrl:]]' or account !~ '^[0-9]{6,20}$' then raise exception 'DESTINATION_INVALID';end if;
 return jsonb_build_object('bank',bank,'holder',holder,'account',account);
end $$;

-- ── Command wrapper ──────────────────────────────────────────────────────
alter function public.uc_investor_capital(text,text,jsonb) rename to uc_capital_before_withdrawal_destinations;
create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; w uc_investor_withdrawals; dest uc_investor_withdrawal_destinations; payout uc_investor_withdrawal_payouts;
 dest_keys text[]:=array['destinationBank','destinationHolder','destinationAccount','destinationConfirmed'];
 req text; extra jsonb; clean jsonb; result jsonb; pot uuid; v_payload jsonb; replay boolean;
begin
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 if p_action='snapshot' then
  result:=uc_capital_before_withdrawal_destinations(p_actor,p_action,p_data);
  -- The inner snapshot already limited this to the Director or the own investor.
  pot:=(result->'position'->>'potId')::uuid;
  return result||jsonb_build_object(
   'withdrawalDestinations',coalesce((select jsonb_agg(uc_withdrawal_destination_view(d) order by d.confirmed_at,d.id) from uc_investor_withdrawal_destinations d where d.pot_id=pot),'[]'::jsonb),
   'withdrawalHistory',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'withdrawalId',a.detail->>'withdrawalId','action',a.action,'actorName',coalesce(nullif(trim(s.name),''),'Staff'),'createdAt',a.created_at) order by a.created_at desc,a.sequence desc)
    from (select * from uc_investor_audit x where x.pot_id=pot and x.detail->>'withdrawalId' is not null order by x.created_at desc,x.sequence desc limit 200) a
    left join garage_building_staff s on s.id=a.actor_id),'[]'::jsonb));
 end if;
 if p_action is null or p_action not in ('approve_withdrawal','withdrawal_paid','confirm_withdrawal_destination') then
  if exists(select 1 from unnest(dest_keys||array['destinationId']) k where p_data ? k) then raise exception 'INVALID';end if;
  return uc_capital_before_withdrawal_destinations(p_actor,p_action,p_data);
 end if;

 -- Director only. Admin, investors and other staff can never approve, set or pay a destination.
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data->'requestId') is distinct from 'string' or p_data->>'requestId' !~ '^[A-Za-z0-9_-]{16,80}$'
  or jsonb_typeof(p_data->'potId') is distinct from 'string' or p_data->>'potId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_data->'withdrawalId') is distinct from 'string' or p_data->>'withdrawalId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
 if p_action='withdrawal_paid' and (exists(select 1 from unnest(dest_keys) k where p_data ? k)
  or (p_data ? 'destinationId' and (jsonb_typeof(p_data->'destinationId') is distinct from 'string' or p_data->>'destinationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))) then raise exception 'INVALID';end if;
 if p_action<>'withdrawal_paid' and p_data ? 'destinationId' then raise exception 'INVALID';end if;
 req:=p_data->>'requestId';
 extra:=coalesce((select jsonb_object_agg(k,p_data->k) from unnest(dest_keys) k where p_data ? k),'{}'::jsonb);
 -- Same lock order as every other money command: shared funding lock, then
 -- the request, then the account, then the withdrawal.
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
 replay:=exists(select 1 from uc_investor_commands where actor_id=p_actor and request_id=req);

 if p_action='confirm_withdrawal_destination' then
  v_payload:=jsonb_build_object('action',p_action,'data',p_data);
  if replay then
   select c.result into result from uc_investor_commands c where c.actor_id=p_actor and c.request_id=req and c.payload=v_payload;
   if result is null then raise exception 'REQUEST_CHANGED';end if;
   return result;
  end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(dest_keys||array['potId','withdrawalId','requestId']))) then raise exception 'INVALID';end if;
 elsif p_action='approve_withdrawal' and replay then
  -- The original command decides; the destination fields must be exactly what was first sent.
  select * into dest from uc_investor_withdrawal_destinations where confirmed_by=p_actor and request_id=req;
  if extra is distinct from coalesce(dest.extra,'{}'::jsonb) then raise exception 'REQUEST_CHANGED';end if;
  result:=uc_capital_before_withdrawal_destinations(p_actor,p_action,p_data-dest_keys);
  return case when dest.id is null then result else result||jsonb_build_object('destination',uc_withdrawal_destination_view(dest)) end;
 elsif p_action='withdrawal_paid' and replay then
  select * into payout from uc_investor_withdrawal_payouts where actor_id=p_actor and request_id=req;
  if (p_data->>'destinationId')::uuid is distinct from payout.destination_id then raise exception 'REQUEST_CHANGED';end if;
  result:=uc_capital_before_withdrawal_destinations(p_actor,p_action,p_data-'destinationId');
  return case when payout.entry_id is null then result else result||jsonb_build_object('destinationId',payout.destination_id) end;
 end if;

 perform 1 from uc_investor_pots where id=(p_data->>'potId')::uuid for update;
 select * into w from uc_investor_withdrawals where id=(p_data->>'withdrawalId')::uuid and pot_id=(p_data->>'potId')::uuid for update;
 if w.id is null then raise exception 'NOT_ALLOWED';end if;
 select * into dest from uc_investor_withdrawal_destinations where withdrawal_id=w.id;

 if p_action='withdrawal_paid' then
  if dest.id is null then raise exception 'DESTINATION_REQUIRED';end if;
  if not(p_data ? 'destinationId') then raise exception 'DESTINATION_REQUIRED';end if;
  -- A stale payment screen cannot pay anywhere but the locked destination.
  if (p_data->>'destinationId')::uuid<>dest.id then raise exception 'DESTINATION_CHANGED';end if;
  result:=uc_capital_before_withdrawal_destinations(p_actor,p_action,p_data-'destinationId');
  insert into uc_investor_withdrawal_payouts(entry_id,withdrawal_id,destination_id,actor_id,request_id) values((result->>'entryId')::uuid,w.id,dest.id,p_actor,req);
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(w.pot_id,p_actor,'withdrawal_paid_to_destination',
   jsonb_build_object('requestId',req,'withdrawalId',w.id,'destinationId',dest.id,'entryId',result->>'entryId','accountLast4',right(dest.account_number,4)));
  return result||jsonb_build_object('destinationId',dest.id);
 end if;

 clean:=uc_withdrawal_destination_input(p_data);
 if p_action='approve_withdrawal' then
  -- The inner command checks the request state, balance and waiting bills.
  result:=uc_capital_before_withdrawal_destinations(p_actor,p_action,p_data-dest_keys);
 else
  if w.state<>'approved' then raise exception 'APPROVAL_REQUIRED';end if;
  if dest.id is not null then raise exception 'DESTINATION_LOCKED';end if;
  result:=jsonb_build_object('potId',w.pot_id,'withdrawalId',w.id);
 end if;
 insert into uc_investor_withdrawal_destinations(withdrawal_id,pot_id,bank_name,account_holder,account_number,confirmed_by,request_id,extra)
 values(w.id,w.pot_id,clean->>'bank',clean->>'holder',clean->>'account',p_actor,req,extra) returning * into dest;
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(w.pot_id,p_actor,'withdrawal_destination_confirmed',
  jsonb_build_object('requestId',req,'withdrawalId',w.id,'destinationId',dest.id,'accountLast4',right(dest.account_number,4)));
 result:=result||jsonb_build_object('destination',uc_withdrawal_destination_view(dest));
 if p_action='confirm_withdrawal_destination' then
  insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,v_payload,result);
 end if;
 return result;
end $$;

alter table public.uc_investor_withdrawal_destinations enable row level security;
alter table public.uc_investor_withdrawal_payouts enable row level security;
revoke all on table public.uc_investor_withdrawal_destinations,public.uc_investor_withdrawal_payouts from public,anon,authenticated,service_role;
revoke all on function public.uc_withdrawal_destination_guard(),public.uc_withdrawal_payout_guard(),public.uc_require_withdrawal_destination(),public.uc_withdrawal_payout_linked(),
 public.uc_withdrawal_approval_has_destination(),public.uc_withdrawal_destination_view(public.uc_investor_withdrawal_destinations),public.uc_withdrawal_destination_input(jsonb),
 public.uc_capital_before_withdrawal_destinations(text,text,jsonb),public.uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_investor_capital(text,text,jsonb) to service_role;
commit;
