-- PREPARED ONLY. Records the Director's choice; does not move cash, recognise
-- an acquisition, or make a trade-in count as received sale money.
begin;
create table public.uc_trade_in_funding_choices (
 id uuid primary key default gen_random_uuid(), incoming_car_id text not null references cars(id), outgoing_car_id text not null references cars(id),
 revision integer not null check(revision>0), previous_id uuid references uc_trade_in_funding_choices(id),
 funding_kind text not null check(funding_kind in ('company','investor')), pot_id uuid references uc_investor_pots(id),
 investor_basis_points integer, gross_cents bigint not null check(gross_cents between 1 and 1000000000000), lender_cents bigint not null check(lender_cents between 0 and 1000000000000),
 reason text, selected_by text not null references garage_building_staff(id), selected_at timestamptz not null default now(),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,80}$'),payload jsonb not null,
 check(incoming_car_id<>outgoing_car_id),check(lender_cents<=gross_cents),
 check((funding_kind='company' and pot_id is null and investor_basis_points is null) or (funding_kind='investor' and pot_id is not null and investor_basis_points between 0 and 10000)),
 unique(incoming_car_id,revision),unique(selected_by,request_id)
);
create trigger uc_trade_in_choices_fixed before update or delete on uc_trade_in_funding_choices for each row execute function uc_investor_immutable();
create trigger uc_trade_in_choices_no_truncate before truncate on uc_trade_in_funding_choices execute function uc_investor_immutable();
create function public.uc_trade_in_choice_view(p_choice uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',c.id,'incomingCarId',c.incoming_car_id,'outgoingCarId',c.outgoing_car_id,'revision',c.revision,
 'fundingKind',c.funding_kind,'potId',c.pot_id,'investorBasisPoints',c.investor_basis_points,'grossCents',c.gross_cents,'lenderCents',c.lender_cents,'netCreditCents',c.gross_cents-c.lender_cents,
 'selectedBy',s.name,'selectedAt',c.selected_at,'reason',c.reason,'status','chosen','financiallyApplied',false,
 'valuationChanged',c.gross_cents is distinct from uc_commission_cents(to_jsonb(incoming)->'purchase_price') or c.lender_cents is distinct from coalesce(uc_commission_cents(to_jsonb(incoming)->'settlement_amount'),0),
 'potName',case when c.funding_kind='company' then 'Company pot' else f.name end)
 from uc_trade_in_funding_choices c join cars incoming on incoming.id=c.incoming_car_id join garage_building_staff s on s.id=c.selected_by left join uc_investor_pots p on p.id=c.pot_id left join uc_investor_profiles f on f.id=p.profile_id where c.id=p_choice $$;
create function public.uc_trade_in_funding(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;incoming jsonb;previous uc_trade_in_funding_choices;existing uc_trade_in_funding_choices;chosen uuid;gross bigint;lender bigint;allowed text[];req text;outgoing text;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role='director' and actor.business_access='both',false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or p_action not in ('snapshot','choose') then raise exception 'INVALID';end if;
 allowed:=case p_action when 'snapshot' then array['incomingCarId'] else array['incomingCarId','fundingKind','potId','investorBasisPoints','expectedChoiceId','reason','requestId'] end;
 if exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) or jsonb_typeof(p_data->'incomingCarId') is distinct from 'string' or p_data->>'incomingCarId' !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception 'INVALID';end if;
 if p_action='choose' then
  req:=p_data->>'requestId';
  if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  perform pg_advisory_xact_lock(hashtextextended('trade-in-choice:'||p_actor||':'||req,0));
  select * into existing from uc_trade_in_funding_choices where selected_by=p_actor and request_id=req;
  if found then if existing.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return jsonb_build_object('choice',uc_trade_in_choice_view(existing.id));end if;
 end if;
 select to_jsonb(c) into incoming from cars c where id=p_data->>'incomingCarId' for update;
 outgoing:=incoming->>'trade_in_source_car_id';
 if incoming is null or nullif(outgoing,'') is null or outgoing=p_data->>'incomingCarId' or not exists(select 1 from cars where id=outgoing) then raise exception 'NOT_A_TRADE_IN';end if;
 select * into previous from uc_trade_in_funding_choices where incoming_car_id=p_data->>'incomingCarId' order by revision desc limit 1;
 if p_action='snapshot' then return jsonb_build_object('choice',uc_trade_in_choice_view(previous.id),'history',coalesce((select jsonb_agg(uc_trade_in_choice_view(h.id) order by h.revision desc) from (select id,revision from uc_trade_in_funding_choices where incoming_car_id=p_data->>'incomingCarId' order by revision desc limit 50) h),'[]'::jsonb));end if;
 if exists(select 1 from uc_investor_cars where car_id=p_data->>'incomingCarId') or incoming->>'status' in ('delivered','deal_pending') then raise exception 'TRADE_IN_FUNDING_LOCKED';end if;
 if exists(select 1 from journal_entries where car_id=p_data->>'incomingCarId' and not coalesce(voided,false)) or exists(select 1 from payments where car_id=p_data->>'incomingCarId') then raise exception 'TRADE_IN_HISTORY_REVIEW_REQUIRED';end if;
 if (previous.id is null and p_data ? 'expectedChoiceId') or (previous.id is not null and coalesce(p_data->>'expectedChoiceId','')<>previous.id::text) then raise exception 'CHOICE_CHANGED';end if;
 if previous.id is not null and (jsonb_typeof(p_data->'reason') is distinct from 'string' or length(trim(p_data->>'reason')) not between 3 and 500) then raise exception 'REASON_REQUIRED';end if;
 if p_data->>'fundingKind'='investor' then
  if jsonb_typeof(p_data->'potId') is distinct from 'string' or p_data->>'potId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_data->'investorBasisPoints') is distinct from 'number' or p_data->>'investorBasisPoints' !~ '^\d{1,5}$' or (p_data->>'investorBasisPoints')::integer>10000 then raise exception 'INVALID';end if;
  if not exists(select 1 from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id where p.id=(p_data->>'potId')::uuid) then raise exception 'INVALID_INVESTOR_ACCOUNT';end if;
 elsif p_data->>'fundingKind'='company' then if p_data ? 'potId' or p_data ? 'investorBasisPoints' then raise exception 'INVALID';end if;
 else raise exception 'FUNDING_CHOICE_REQUIRED';end if;
 gross:=uc_commission_cents(incoming->'purchase_price');lender:=coalesce(uc_commission_cents(incoming->'settlement_amount'),0);
 if coalesce(gross,0)<=0 then raise exception 'TRADE_IN_VALUE_REQUIRED';end if;
 if lender>gross then raise exception 'NEGATIVE_EQUITY_REVIEW_REQUIRED';end if;
 insert into uc_trade_in_funding_choices(incoming_car_id,outgoing_car_id,revision,previous_id,funding_kind,pot_id,investor_basis_points,gross_cents,lender_cents,reason,selected_by,request_id,payload)
 values(p_data->>'incomingCarId',outgoing,coalesce(previous.revision,0)+1,previous.id,p_data->>'fundingKind',case when p_data->>'fundingKind'='investor' then (p_data->>'potId')::uuid end,
 case when p_data->>'fundingKind'='investor' then (p_data->>'investorBasisPoints')::integer end,gross,lender,nullif(trim(p_data->>'reason'),''),p_actor,req,p_data) returning id into chosen;
 return jsonb_build_object('choice',uc_trade_in_choice_view(chosen));
end $$;
alter table uc_trade_in_funding_choices enable row level security;
revoke all on uc_trade_in_funding_choices from public,anon,authenticated,service_role;
revoke all on function uc_trade_in_choice_view(uuid),uc_trade_in_funding(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_trade_in_funding(text,text,jsonb) to service_role;
commit;
