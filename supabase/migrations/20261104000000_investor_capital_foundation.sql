-- PREPARED ONLY. Not installed. First local phase: investor profiles, capital
-- history and withdrawal approvals. No car funding, bills, salary, settlement,
-- bank import, public signup or legacy-table permission changes in this phase.
create table public.uc_investor_profiles (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 150),
 linked_staff_id text unique references public.garage_building_staff(id),
 created_by text not null references public.garage_building_staff(id), created_at timestamptz not null default now()
);
create table public.uc_investor_pots (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null unique references public.uc_investor_profiles(id),
 created_at timestamptz not null default now()
);
create table public.uc_investor_withdrawals (
 id uuid primary key default gen_random_uuid(), pot_id uuid not null references public.uc_investor_pots(id),
 amount_cents bigint not null check(amount_cents between 1 and 1000000000000),
 state text not null default 'requested' check(state in ('requested','approved','rejected','paid','cancelled')),
 requested_by text not null references public.garage_building_staff(id), requested_at timestamptz not null default now(),
 reviewed_by text references public.garage_building_staff(id), reviewed_at timestamptz, review_note text,
 check((state='requested' and reviewed_by is null and reviewed_at is null) or (state<>'requested' and reviewed_by is not null and reviewed_at is not null))
);
create table public.uc_investor_cash_entries (
 id uuid primary key default gen_random_uuid(), pot_id uuid not null references public.uc_investor_pots(id),
 kind text not null check(kind in ('capital_in','withdrawal_out')),
 amount_cents bigint not null check(abs(amount_cents::numeric) between 1 and 1000000000000),
 withdrawal_id uuid unique references public.uc_investor_withdrawals(id),
 bank_account text not null check(length(trim(bank_account)) between 1 and 150),
 bank_reference text not null check(length(trim(bank_reference)) between 1 and 200),
 paid_on date not null, recorded_by text not null references public.garage_building_staff(id), recorded_at timestamptz not null default now(),
 check((kind='capital_in' and amount_cents>0 and withdrawal_id is null) or (kind='withdrawal_out' and amount_cents<0 and withdrawal_id is not null)),
 unique(bank_account,bank_reference)
);
create unique index uc_investor_bank_reference on public.uc_investor_cash_entries(lower(trim(bank_account)),lower(trim(bank_reference)));
create table public.uc_investor_commands (
 actor_id text not null references public.garage_building_staff(id), request_id text not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
create table public.uc_investor_audit (
 id uuid primary key default gen_random_uuid(), pot_id uuid not null references public.uc_investor_pots(id),
 actor_id text not null references public.garage_building_staff(id), action text not null,
 detail jsonb not null, created_at timestamptz not null default now()
);
create index uc_investor_entries_pot on public.uc_investor_cash_entries(pot_id,recorded_at,id);
create index uc_investor_withdrawals_pot on public.uc_investor_withdrawals(pot_id,state);
create index uc_investor_audit_pot on public.uc_investor_audit(pot_id,created_at,id);

create function public.uc_investor_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'IMMUTABLE_HISTORY'; end $$;
create trigger uc_investor_entries_fixed before update or delete on public.uc_investor_cash_entries for each row execute function public.uc_investor_immutable();
create trigger uc_investor_audit_fixed before update or delete on public.uc_investor_audit for each row execute function public.uc_investor_immutable();
create trigger uc_investor_commands_fixed before update or delete on public.uc_investor_commands for each row execute function public.uc_investor_immutable();
create trigger uc_investor_entries_no_truncate before truncate on public.uc_investor_cash_entries execute function public.uc_investor_immutable();
create trigger uc_investor_audit_no_truncate before truncate on public.uc_investor_audit execute function public.uc_investor_immutable();
create trigger uc_investor_commands_no_truncate before truncate on public.uc_investor_commands execute function public.uc_investor_immutable();
create function public.uc_investor_withdrawal_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if (to_jsonb(new)-array['state','reviewed_by','reviewed_at','review_note']) is distinct from
    (to_jsonb(old)-array['state','reviewed_by','reviewed_at','review_note']) then raise exception 'IMMUTABLE_WITHDRAWAL';end if;
 if not ((old.state='requested' and new.state in ('approved','rejected','cancelled')) or (old.state='approved' and new.state in ('paid','cancelled'))) then raise exception 'INVALID_WITHDRAWAL_TRANSITION';end if;
 if new.state='paid' and (new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at or new.review_note is distinct from old.review_note) then raise exception 'IMMUTABLE_APPROVAL';end if;
 return new;
end $$;
create trigger uc_investor_withdrawal_state before update on public.uc_investor_withdrawals for each row execute function public.uc_investor_withdrawal_guard();

-- Private helper. Called only after actor and ownership checks in the command.
create function public.uc_investor_position(p_pot uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('potId',p_pot,'cashCents',c.amount,'reservedCents',w.amount,'availableCents',c.amount-w.amount)
 from (select coalesce(sum(amount_cents),0) amount from uc_investor_cash_entries where pot_id=p_pot) c
 cross join (select coalesce(sum(amount_cents),0) amount from uc_investor_withdrawals where pot_id=p_pot and state='approved') w;
$$;

create function public.uc_investor_capital(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; profile uc_investor_profiles; pot uc_investor_pots;
 withdrawal uc_investor_withdrawals; prior uc_investor_commands; linked garage_building_staff;
 request text:=p_data->>'requestId'; payload jsonb:=jsonb_build_object('action',p_action,'data',p_data);
 result jsonb; position jsonb; amount bigint; day date; entry_id uuid; allowed text[];
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('used_car','both') and actor.role in ('director','investor'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'INVALID';end if;
 allowed:=case p_action
 when 'create_profile' then array['name','requestId']
 when 'link_account' then array['potId','staffId','requestId']
 when 'snapshot' then array['potId']
 when 'capital_received' then array['potId','amountCents','paidOn','bankAccount','bankReference','requestId']
 when 'request_withdrawal' then array['potId','amountCents','requestId']
 when 'approve_withdrawal' then array['potId','withdrawalId','requestId']
 when 'reject_withdrawal' then array['potId','withdrawalId','note','requestId']
 when 'cancel_withdrawal' then array['potId','withdrawalId','note','requestId']
 when 'withdrawal_paid' then array['potId','withdrawalId','paidOn','bankAccount','bankReference','requestId'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception 'INVALID';end if;
 if actor.role<>'director' and p_action not in ('snapshot','request_withdrawal') then raise exception 'NOT_ALLOWED';end if;
 if p_action='request_withdrawal' and actor.role<>'investor' then raise exception 'INVESTOR_REQUEST_REQUIRED';end if;
 if p_action<>'snapshot' then
  if request is null or request !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  -- Serialises identical request IDs even when they mention different pots.
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||request,0));
  select * into prior from uc_investor_commands where actor_id=p_actor and request_id=request;
  if found then
   if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;
   return prior.result;
  end if;
 end if;
 if p_action='create_profile' then
  if jsonb_typeof(p_data->'name') is distinct from 'string' or length(trim(p_data->>'name')) not between 1 and 150 then raise exception 'INVALID';end if;
  insert into uc_investor_profiles(name,created_by) values(trim(p_data->>'name'),p_actor) returning * into profile;
  insert into uc_investor_pots(profile_id) values(profile.id) returning * into pot;
  result:=jsonb_build_object('profileId',profile.id,'potId',pot.id,'cashCents',0);
 else
  if p_action='snapshot' then
   select p.* into pot from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id
   where (actor.role='director' and p.id=(p_data->>'potId')::uuid) or
    (actor.role='investor' and f.linked_staff_id=p_actor and (not(p_data ? 'potId') or p.id=(p_data->>'potId')::uuid));
  else
   select p.* into pot from uc_investor_pots p join uc_investor_profiles f on f.id=p.profile_id
   where p.id=(p_data->>'potId')::uuid and (actor.role='director' or f.linked_staff_id=p_actor) for update of p;
  end if;
  if pot.id is null then raise exception 'NOT_ALLOWED';end if;
  if p_action='snapshot' then select * into profile from uc_investor_profiles where id=pot.profile_id;
  else select * into profile from uc_investor_profiles where id=pot.profile_id for update;end if;
  if p_action='snapshot' then
   -- No other investor, salary, bank-account or staff-directory fields exposed.
   return jsonb_build_object('profile',jsonb_build_object('id',profile.id,'name',profile.name,'hasLogin',profile.linked_staff_id is not null),
    'position',uc_investor_position(pot.id),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'amountCents',e.amount_cents,'paidOn',e.paid_on,'recordedAt',e.recorded_at) order by e.recorded_at desc,e.id) from uc_investor_cash_entries e where e.pot_id=pot.id),'[]'::jsonb),
    'withdrawals',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'amountCents',w.amount_cents,'state',w.state,'requestedAt',w.requested_at,'reviewedAt',w.reviewed_at,'note',w.review_note) order by w.requested_at desc,w.id) from uc_investor_withdrawals w where w.pot_id=pot.id),'[]'::jsonb));
  end if;
  position:=uc_investor_position(pot.id);
  if p_action='link_account' then
   if profile.linked_staff_id is not null then raise exception 'ALREADY_LINKED';end if;
   select * into linked from garage_building_staff where id=p_data->>'staffId' for share;
   if linked.id is null or not coalesce(linked.enabled and linked.registration_status='active' and linked.role='investor' and linked.business_access in ('used_car','both'),false) then raise exception 'INVALID_INVESTOR_ACCOUNT';end if;
   update uc_investor_profiles set linked_staff_id=linked.id where id=profile.id;
  elsif p_action in ('capital_received','request_withdrawal') then
   if jsonb_typeof(p_data->'amountCents') is distinct from 'number' or coalesce(p_data->>'amountCents','') !~ '^[1-9][0-9]{0,12}$' then raise exception 'INVALID';end if;
   amount:=(p_data->>'amountCents')::bigint;
   if amount>1000000000000 then raise exception 'INVALID';end if;
   if p_action='capital_received' and (position->>'cashCents')::numeric+amount>1000000000000 then raise exception 'BALANCE_LIMIT';end if;
   if p_action='request_withdrawal' then
    if amount>(position->>'availableCents')::numeric then raise exception 'INSUFFICIENT_FUNDS';end if;
    insert into uc_investor_withdrawals(pot_id,amount_cents,requested_by) values(pot.id,amount,p_actor) returning * into withdrawal;
   end if;
  else
   select * into withdrawal from uc_investor_withdrawals where id=(p_data->>'withdrawalId')::uuid and pot_id=pot.id for update;
   if withdrawal.id is null then raise exception 'NOT_ALLOWED';end if;
   if p_action='cancel_withdrawal' then
    if withdrawal.state not in ('requested','approved') then raise exception 'ALREADY_REVIEWED';end if;
    if jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 1 and 500 then raise exception 'REASON_REQUIRED';end if;
    update uc_investor_withdrawals set state='cancelled',reviewed_by=p_actor,reviewed_at=now(),review_note=trim(p_data->>'note') where id=withdrawal.id;
   elsif p_action in ('approve_withdrawal','reject_withdrawal') then
    if withdrawal.state<>'requested' then raise exception 'ALREADY_REVIEWED';end if;
    if p_action='approve_withdrawal' and withdrawal.amount_cents>(position->>'availableCents')::numeric then raise exception 'INSUFFICIENT_FUNDS';end if;
    if p_action='reject_withdrawal' and (jsonb_typeof(p_data->'note') is distinct from 'string' or length(trim(p_data->>'note')) not between 1 and 500) then raise exception 'REASON_REQUIRED';end if;
    update uc_investor_withdrawals set state=case when p_action='approve_withdrawal' then 'approved' else 'rejected' end,
     reviewed_by=p_actor,reviewed_at=now(),review_note=case when p_action='reject_withdrawal' then trim(p_data->>'note') end where id=withdrawal.id;
   elsif p_action='withdrawal_paid' then
    if withdrawal.state<>'approved' then raise exception 'APPROVAL_REQUIRED';end if;
    if (position->>'availableCents')::numeric<0 or withdrawal.amount_cents>(position->>'cashCents')::numeric then raise exception 'INSUFFICIENT_FUNDS';end if;
    amount:=-withdrawal.amount_cents;
   end if;
  end if;
  if p_action in ('capital_received','withdrawal_paid') then
   if jsonb_typeof(p_data->'bankAccount') is distinct from 'string' or length(trim(p_data->>'bankAccount')) not between 1 and 150
    or jsonb_typeof(p_data->'bankReference') is distinct from 'string' or length(trim(p_data->>'bankReference')) not between 1 and 200
    or coalesce(p_data->>'paidOn','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID';end if;
   day:=(p_data->>'paidOn')::date;
   if day>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'FUTURE_PAYMENT';end if;
   if p_action='withdrawal_paid' and day<(withdrawal.reviewed_at at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'PAYMENT_BEFORE_APPROVAL';end if;
   insert into uc_investor_cash_entries(pot_id,kind,amount_cents,withdrawal_id,bank_account,bank_reference,paid_on,recorded_by)
   values(pot.id,case when p_action='capital_received' then 'capital_in' else 'withdrawal_out' end,amount,
    case when p_action='withdrawal_paid' then withdrawal.id end,trim(p_data->>'bankAccount'),trim(p_data->>'bankReference'),day,p_actor) returning id into entry_id;
   if p_action='withdrawal_paid' then update uc_investor_withdrawals set state='paid' where id=withdrawal.id;end if;
  end if;
  result:=jsonb_build_object('potId',pot.id,'profileId',profile.id,'position',uc_investor_position(pot.id),'withdrawalId',withdrawal.id,'entryId',entry_id);
 end if;
 insert into uc_investor_audit(pot_id,actor_id,action,detail) values(pot.id,p_actor,p_action,jsonb_build_object('requestId',request,'withdrawalId',withdrawal.id,'entryId',entry_id));
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,request,payload,result);
 return result;
end $$;

-- New tables start private. This does NOT change old app tables or grants.
alter table public.uc_investor_profiles enable row level security;
alter table public.uc_investor_pots enable row level security;
alter table public.uc_investor_withdrawals enable row level security;
alter table public.uc_investor_cash_entries enable row level security;
alter table public.uc_investor_commands enable row level security;
alter table public.uc_investor_audit enable row level security;
revoke all on table public.uc_investor_profiles,public.uc_investor_pots,public.uc_investor_withdrawals,public.uc_investor_cash_entries,public.uc_investor_commands,public.uc_investor_audit from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_immutable() from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_withdrawal_guard() from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_position(uuid) from public,anon,authenticated,service_role;
revoke all on function public.uc_investor_capital(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_investor_capital(text,text,jsonb) to service_role;
