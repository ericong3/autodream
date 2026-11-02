-- PREPARED ONLY: requires owner approval before running. No unrelated migrations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ DECLARE r record;BEGIN
 IF to_regclass('public.garage_referral_transfers') IS NOT NULL THEN RAISE EXCEPTION 'STOP: settlement already installed; review rather than replay';END IF;
 FOR r IN SELECT * FROM (VALUES
('garage_installation_before_damage(text,text,jsonb)','1bbe2376fff966561b4423a80f3a939b'),
('garage_work_status_from_facts(text)','c936e59b7c9b21baa6c16f0b1f4758fd'),
('garage_tint_finance(text,text,jsonb)','c55ff9be79c1e1b22f936e2e4b81807d')
 ) b(signature,hash) LOOP
  IF to_regprocedure(r.signature) IS NULL OR md5(pg_get_functiondef(to_regprocedure(r.signature)))<>r.hash THEN
   RAISE EXCEPTION 'STOP: baseline changed for %',r.signature;
  END IF;
 END LOOP;
END $guard$;
-- Prepared only. Install the guarded bundle after approval; never migrate-all.
create table public.garage_referral_transfers (
 id uuid primary key default gen_random_uuid(), invoice_id text not null references garage_invoices(id),
 amount numeric(16,2) not null check(amount>0), reference text not null, reported_by text not null references garage_building_staff(id),
 reported_at timestamptz not null default now(), state text not null default 'reported' check(state in ('reported','accepted','rejected')),
 reviewed_by text references garage_building_staff(id), reviewed_at timestamptz, review_note text,
 payment_id text unique references garage_tint_payments(id)
);
create table public.garage_referral_releases (
 invoice_id text primary key references garage_invoices(id), deal jsonb not null,
 authorised_by text not null references garage_building_staff(id), authorised_at timestamptz not null default now(), reason text not null
);
create table public.garage_referral_payouts (
 id uuid primary key default gen_random_uuid(), invoice_id text not null references garage_sales_assignments(invoice_id),
 amount numeric(16,2) not null check(amount>0), paid_on date not null, reference text not null,
 recipient_snapshot jsonb not null, recorded_by text not null references garage_building_staff(id), recorded_at timestamptz not null default now()
);
create table public.garage_referral_settlement_requests (
 actor_id text not null references garage_building_staff(id), request_id text not null, payload jsonb not null, result jsonb not null,
 primary key(actor_id,request_id)
);
do $$declare t text;begin
 foreach t in array array['garage_referral_transfers','garage_referral_releases','garage_referral_payouts','garage_referral_settlement_requests'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end$$;

-- The authoriser must still be active, and the exact approved deal must still match.
create function public.garage_used_car_release_allowed(p_invoice text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from garage_referral_releases r
 join garage_sales_assignments a on a.invoice_id=r.invoice_id and a.referrer_kind='used_car' and a.used_car_deal=r.deal
 join cars c on c.id=r.deal->>'carId' and c.final_deal->>'submittedAt'=r.deal->>'submittedAt' and c.final_deal->>'approvalStatus'='approved'
 join customers cu on cu.id=r.deal->>'customerId' and cu.interested_car_id=c.id
 join garage_building_staff s on s.id=r.authorised_by and s.enabled and s.registration_status='active' and s.business_access in ('used_car','both')
 where r.invoice_id=p_invoice and cu.assigned_sales_id=a.referrer_staff_id and c.assigned_salesperson=a.referrer_staff_id
 and (s.role='director' or (s.role='salesperson' and s.id=a.referrer_staff_id)));
$$;
revoke all on function public.garage_used_car_release_allowed(text) from public,anon,authenticated;

-- Hold the exact deal/authoriser steady during authorisation and handover.
create function public.garage_locked_used_car_release(p_invoice text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from garage_referral_releases r
 join garage_sales_assignments a on a.invoice_id=r.invoice_id and a.referrer_kind='used_car' and a.used_car_deal=r.deal
 join cars c on c.id=r.deal->>'carId' and c.final_deal->>'submittedAt'=r.deal->>'submittedAt' and c.final_deal->>'approvalStatus'='approved'
 join customers cu on cu.id=r.deal->>'customerId' and cu.interested_car_id=c.id
 join garage_building_staff s on s.id=r.authorised_by and s.enabled and s.registration_status='active' and s.business_access in ('used_car','both')
 where r.invoice_id=p_invoice and cu.assigned_sales_id=a.referrer_staff_id and c.assigned_salesperson=a.referrer_staff_id
 and (s.role='director' or (s.role='salesperson' and s.id=a.referrer_staff_id)) for share of r,a,c,cu,s;
 return found;
end$$;
revoke all on function public.garage_locked_used_car_release(text) from public,anon,authenticated;

-- One private row per order. Native verified receipts are the only money authority.
create function public.garage_referral_income_row(p_invoice text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('invoiceId',a.invoice_id,'invoiceNumber',i.invoice_number,'createdAt',a.created_at,
 'referrerKind',a.referrer_kind,'staffId',a.referrer_staff_id,'profileId',a.referrer_profile_id,'recipient',a.recipient_snapshot,
 'linkedDeal',a.used_car_deal,'total',m.total_amount,'verified',v.amount,'balance',greatest(0,m.total_amount-v.amount),
 'commission',round(a.basis*a.rate,2),'payable',a.rate is not null and m.total_amount>0 and v.amount>=m.total_amount,
 'paid',p.amount,'remainingCommission',case when m.total_amount>0 and v.amount>=m.total_amount then greatest(0,round(a.basis*a.rate,2)-p.amount) else 0 end,
 'releaseAuthorised',garage_used_car_release_allowed(a.invoice_id),'deliveredAt',i.delivered_at)
 from garage_sales_assignments a join garage_invoices i on i.id=a.invoice_id join garage_tint_accounts m on m.invoice_id=i.id
 cross join lateral (select coalesce(sum(amount),0) amount from garage_tint_payments where invoice_id=i.id and state='verified') v
 cross join lateral (select coalesce(sum(amount),0) amount from garage_referral_payouts where invoice_id=i.id) p
 where a.invoice_id=p_invoice and a.referrer_kind<>'none';
$$;
revoke all on function public.garage_referral_income_row(text) from public,anon,authenticated;

create function public.garage_referral_settlement(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; inv garage_invoices; a garage_sales_assignments;
 prior garage_referral_settlement_requests; transfer garage_referral_transfers;
 iid text:=p_data->>'invoiceId'; req text:=p_data->>'requestId'; payload jsonb:=jsonb_build_object('action',p_action,'data',p_data);
 manager boolean;garage_reader boolean;uc_reader boolean;row jsonb;result jsonb;money jsonb;amount numeric;paid numeric;month text:=p_data->>'month';
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active',false) then raise exception 'NOT_ALLOWED';end if;
 manager:=coalesce(actor.role='director' and actor.business_access in ('garage','both'),false);
 garage_reader:=coalesce(actor.business_access in ('garage','both') and actor.role in ('director','shareholder','garage_head','garage_salesman'),false);
 uc_reader:=coalesce(actor.business_access in ('used_car','both') and actor.role in ('director','salesperson'),false);
 if not (garage_reader or uc_reader) then raise exception 'NOT_ALLOWED';end if;
 if p_action='month' then
  if coalesce(month,'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID';end if;
  -- Orders from the selected month plus older orders with a payout in this month.
  select jsonb_build_object('enabled',true,'canPay',manager,'canReport',uc_reader,'orders',coalesce(jsonb_agg(garage_referral_income_row(s.invoice_id) order by s.created_at desc),'[]'::jsonb)) into result
  from garage_sales_assignments s where s.referrer_kind<>'none'
  and (garage_reader and (actor.role<>'garage_salesman' or s.owner_id=p_actor) or uc_reader and (actor.role='director' or s.referrer_staff_id=p_actor))
  and (to_char(s.created_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM')=month or exists(select 1 from garage_referral_payouts p where p.invoice_id=s.invoice_id and to_char(p.paid_on,'YYYY-MM')=month));
  return result||jsonb_build_object('outstandingOrders',coalesce((select jsonb_agg(x.income order by s.created_at desc)
   from garage_sales_assignments s cross join lateral (select garage_referral_income_row(s.invoice_id) income) x
   where s.referrer_kind<>'none' and (garage_reader and (actor.role<>'garage_salesman' or s.owner_id=p_actor) or uc_reader and (actor.role='director' or s.referrer_staff_id=p_actor))
   and ((x.income->>'balance')::numeric>0 or (x.income->>'commission')::numeric>(x.income->>'paid')::numeric)),'[]'::jsonb),
   'paidThisMonth',coalesce((select sum(p.amount) from garage_referral_payouts p join garage_sales_assignments s on s.invoice_id=p.invoice_id
   where to_char(p.paid_on,'YYYY-MM')=month and (garage_reader and (actor.role<>'garage_salesman' or s.owner_id=p_actor) or uc_reader and (actor.role='director' or s.referrer_staff_id=p_actor))),0));
 end if;
 select * into inv from garage_invoices where id=iid for update;
 select * into a from garage_sales_assignments where invoice_id=iid;
 if inv.id is null or a.invoice_id is null or a.referrer_kind='none' or not coalesce(garage_reader and (actor.role<>'garage_salesman' or a.owner_id=p_actor) or uc_reader and (actor.role='director' or a.referrer_staff_id=p_actor),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action='snapshot' then
  return jsonb_build_object('enabled',true,'order',garage_referral_income_row(iid),'canPay',manager,
   'canReport',uc_reader and a.referrer_kind='used_car' and (actor.role='director' or a.referrer_staff_id=p_actor),
   'canRelease',uc_reader and a.used_car_deal is not null and (actor.role='director' or a.referrer_staff_id=p_actor),
   'transfers',coalesce((select jsonb_agg(to_jsonb(t) order by reported_at desc) from garage_referral_transfers t where invoice_id=iid),'[]'::jsonb),
   'payouts',coalesce((select jsonb_agg(to_jsonb(p)-'recipient_snapshot' order by paid_on desc,recorded_at desc) from garage_referral_payouts p where invoice_id=iid),'[]'::jsonb),
   'release',(select to_jsonb(r) from garage_referral_releases r where invoice_id=iid));
 end if;
 if coalesce(req,'') !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(hashtext('garage_referral_settlement:'||p_actor||':'||req));
 select * into prior from garage_referral_settlement_requests where actor_id=p_actor and request_id=req;
 if found then if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
 if p_action='release' then
  if not uc_reader or a.referrer_kind<>'used_car' or a.used_car_deal is null or (actor.role<>'director' and a.referrer_staff_id<>p_actor) or inv.delivered_at is not null then raise exception 'NOT_ALLOWED';end if;
  if nullif(trim(p_data->>'note'),'') is null then raise exception 'REASON_REQUIRED';end if;
  insert into garage_referral_releases(invoice_id,deal,authorised_by,reason) values(iid,a.used_car_deal,p_actor,trim(p_data->>'note')) on conflict(invoice_id) do nothing;
  if not garage_locked_used_car_release(iid) then raise exception 'DEAL_CHANGED';end if;
  perform garage_reconcile_work_status(iid);
 elsif p_action='report_transfer' then
  if not uc_reader or a.referrer_kind<>'used_car' or (actor.role<>'director' and a.referrer_staff_id<>p_actor) then raise exception 'NOT_ALLOWED';end if;
  if jsonb_typeof(p_data->'amount') is distinct from 'number' or (p_data->>'amount') !~ '^\d{1,12}(\.\d{1,2})?$' or nullif(trim(p_data->>'reference'),'') is null then raise exception 'INVALID';end if;
  amount:=(p_data->>'amount')::numeric;
  row:=garage_referral_income_row(iid);
  if amount<=0 or amount>(row->>'balance')::numeric-coalesce((select sum(t.amount) from garage_referral_transfers t where invoice_id=iid and state='reported'),0) then raise exception 'AMOUNT_EXCEEDS_BALANCE';end if;
  insert into garage_referral_transfers(invoice_id,amount,reference,reported_by) values(iid,amount,trim(p_data->>'reference'),p_actor);
 elsif p_action in ('accept_transfer','reject_transfer') then
  if not manager then raise exception 'NOT_ALLOWED';end if;
  select * into transfer from garage_referral_transfers where id=(p_data->>'transferId')::uuid and invoice_id=iid for update;
  if transfer.id is null or transfer.state<>'reported' then raise exception 'ALREADY_REVIEWED';end if;
  if p_action='accept_transfer' then
   -- The existing ledger reserves reported direct payments too: they cannot be counted again as a transfer.
   money:=garage_tint_finance(p_actor,'record',jsonb_build_object('invoiceId',iid,'amount',transfer.amount,'method','transfer','reference','Used Car: '||transfer.reference,'requestId','transfer_'||req));
   perform garage_tint_finance(p_actor,'verify',jsonb_build_object('invoiceId',iid,'paymentId',money->>'paymentId','note','Used Car transfer verified: '||transfer.reference,'requestId','verify_'||req));
   update garage_referral_transfers set state='accepted',payment_id=money->>'paymentId',reviewed_by=p_actor,reviewed_at=now() where id=transfer.id;
  else
   if nullif(trim(p_data->>'note'),'') is null then raise exception 'REASON_REQUIRED';end if;
   update garage_referral_transfers set state='rejected',reviewed_by=p_actor,reviewed_at=now(),review_note=trim(p_data->>'note') where id=transfer.id;
  end if;
 elsif p_action='payout' then
  if not manager then raise exception 'NOT_ALLOWED';end if;
  row:=garage_referral_income_row(iid);
  if (row->>'payable')::boolean is not true then raise exception 'PAYMENT_NOT_VERIFIED';end if;
  if jsonb_typeof(p_data->'amount') is distinct from 'number' or (p_data->>'amount') !~ '^\d{1,12}(\.\d{1,2})?$' or nullif(trim(p_data->>'reference'),'') is null or coalesce(p_data->>'paidOn','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID';end if;
  amount:=(p_data->>'amount')::numeric;
  if amount<=0 or amount>(row->>'remainingCommission')::numeric or (p_data->>'paidOn')::date>(now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'AMOUNT_EXCEEDS_BALANCE';end if;
  insert into garage_referral_payouts(invoice_id,amount,paid_on,reference,recipient_snapshot,recorded_by)
   values(iid,amount,(p_data->>'paidOn')::date,trim(p_data->>'reference'),a.recipient_snapshot||jsonb_build_object('staffId',a.referrer_staff_id,'profileId',a.referrer_profile_id,
    'payeeProfile',case when a.referrer_kind='external' then (select profile from garage_referral_profiles where id=a.referrer_profile_id)
     else (select jsonb_build_object('name',u.name,'bank',to_jsonb(u)->'bank_name','bankAccount',to_jsonb(u)->'bank_account_number','bankHolder',to_jsonb(u)->'bank_account_holder') from users u where u.id=a.referrer_staff_id) end),p_actor);
 else raise exception 'INVALID';end if;
 result:=jsonb_build_object('ok',true,'order',garage_referral_income_row(iid));
 insert into garage_referral_settlement_requests values(p_actor,req,payload,result);
 return result;
end$$;
revoke all on function public.garage_referral_settlement(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.garage_referral_settlement(text,text,jsonb) to service_role;

-- Partner statements use the existing private session, never a caller-selected profile.
create function public.garage_referral_partner_income(p_token_hash text,p_month text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare account jsonb;pid uuid;result jsonb;
begin
 account:=garage_referral_account('session',null,jsonb_build_object('tokenHash',p_token_hash));pid:=(account->>'id')::uuid;
 if coalesce(p_month,'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID';end if;
 select jsonb_build_object('enabled',true,'orders',coalesce(jsonb_agg(jsonb_build_object('invoiceNumber',i.invoice_number,'createdAt',a.created_at,
  'commission',round(a.basis*a.rate,2),'payable',(garage_referral_income_row(a.invoice_id)->>'payable')::boolean,
  'paid',coalesce((select sum(amount) from garage_referral_payouts where invoice_id=a.invoice_id),0)) order by a.created_at desc),'[]'::jsonb)) into result
 from garage_sales_assignments a join garage_invoices i on i.id=a.invoice_id where a.referrer_profile_id=pid
 and (to_char(a.created_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM')=p_month or exists(select 1 from garage_referral_payouts p where p.invoice_id=a.invoice_id and to_char(p.paid_on,'YYYY-MM')=p_month));
 return result||jsonb_build_object('paidThisMonth',coalesce((select sum(p.amount) from garage_referral_payouts p join garage_sales_assignments a on a.invoice_id=p.invoice_id where a.referrer_profile_id=pid and to_char(p.paid_on,'YYYY-MM')=p_month),0));
end$$;
revoke all on function public.garage_referral_partner_income(text,text) from public,anon,authenticated;
grant execute on function public.garage_referral_partner_income(text,text) to service_role;

-- Narrow additions to the existing delivery/payment gates. Nothing is marked paid by release.
do $patch$
declare d text;c text;
begin
 d:=pg_get_functiondef('public.garage_installation_before_damage(text,text,jsonb)'::regprocedure);
 c:=replace(d,'if p_action=''deliver'' and exists','if p_action=''deliver'' and not public.garage_locked_used_car_release(iid) and exists');
 if c=d then raise exception 'STOP: delivery payment gate baseline changed';end if;execute c;
 d:=pg_get_functiondef('public.garage_work_status_from_facts(text)'::regprocedure);
 c:=replace(d,'return public.garage_legacy_work_status_from_facts(p_invoice_id);',
 'if w.state=''ready'' and w.head_at is not null and w.sales_at is not null and public.garage_used_car_release_allowed(p_invoice_id) and exists(select 1 from public.garage_invoices where id=p_invoice_id and delivered_at is null and warranty_registered_at is null) then return ''ready_for_delivery'';end if; return public.garage_legacy_work_status_from_facts(p_invoice_id);');
 if c=d then raise exception 'STOP: delivery stage baseline changed';end if;execute c;
 d:=pg_get_functiondef('public.garage_tint_finance(text,text,jsonb)'::regprocedure);
 c:=replace(d,'if inv.delivered_at is not null then raise exception ''ORDER_DELIVERED'';',
 'if inv.delivered_at is not null and not exists(select 1 from public.garage_sales_assignments where invoice_id=iid and referrer_kind=''used_car'') then raise exception ''ORDER_DELIVERED'';');
 if c=d then raise exception 'STOP: receipt baseline changed';end if;execute c;
end $patch$;

create function public.garage_referral_review_stage() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.state='ready' and public.garage_used_car_release_allowed(new.invoice_id) then
  perform public.garage_reconcile_work_status(new.invoice_id);
 end if;
 return new;
end$$;
revoke all on function public.garage_referral_review_stage() from public,anon,authenticated;
create trigger garage_referral_review_stage after update of revision on public.garage_installation_reviews
for each row when (new.state='ready') execute function public.garage_referral_review_stage();

NOTIFY pgrst,'reload schema';
COMMIT;
SELECT jsonb_build_object('checked_at',now(),'settlement_ready',to_regprocedure('public.garage_referral_settlement(text,text,jsonb)') IS NOT NULL,
 'partner_income_ready',to_regprocedure('public.garage_referral_partner_income(text,text)') IS NOT NULL,
 'private_functions',NOT has_function_privilege('anon','public.garage_referral_settlement(text,text,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.garage_referral_partner_income(text,text)','EXECUTE'),
 'admin_release_excluded',position('s.role=''salesperson''' in pg_get_functiondef('public.garage_used_car_release_allowed(text)'::regprocedure))>0);
