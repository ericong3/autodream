-- PREPARED ONLY. Install after the investor activation migration and a reviewed
-- opening balance/cutover. Never backfill historical bank movements blindly.
begin;
do $$ begin
 if to_regclass('public.uc_investor_banks') is null then raise exception 'INVESTOR_ACTIVATION_REQUIRED';end if;
 if (select count(*) from ledger_accounts where (id='acct-ap' and type='liability') or (id='acct-investor-payable' and type='liability') or (id='acct-inv-investor' and type='asset') or (id='acct-rev-investor-share' and type='revenue') or (id='acct-equity' and type='equity'))<>5 then raise exception 'INVESTOR_CHART_REVIEW_REQUIRED';end if;
 if exists(select 1 from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where not j.voided and l->>'accountId' in ('acct-investor-payable','acct-inv-investor','acct-rev-investor-share') group by l->>'accountId' having sum((l->>'debit')::numeric-(l->>'credit')::numeric)<>0) then raise exception 'INVESTOR_OPENING_BALANCES_REVIEW_REQUIRED';end if;
end $$;
alter table public.cars add column investor_funded boolean not null default false;

create or replace function public.uc_funded_car_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if TG_TABLE_NAME='uc_investor_cars' then
  -- Existing paid/posted history needs an explicit opening-balance conversion.
  -- Refuse it rather than purchasing the same car a second time.
  if exists(select 1 from journal_entries where car_id=new.car_id and not coalesce(voided,false))
    or exists(select 1 from payments where car_id=new.car_id)
  then raise exception 'CAR_HISTORY_REVIEW_REQUIRED';end if;
  update cars set investor_funded=true where id=new.car_id;
 else
  if TG_OP='INSERT' then
   if new.investor_id is not null then raise exception 'USE_INVESTOR_ACCOUNTS';end if;
   if new.investor_funded then raise exception 'FUNDING_ACCOUNT_REQUIRED';end if;
   return new;
  end if;
  if new.investor_funded is distinct from old.investor_funded and not exists(select 1 from uc_investor_cars where car_id=new.id) then raise exception 'FUNDING_ACCOUNT_REQUIRED';end if;
  if new.investor_id is distinct from old.investor_id and new.investor_id is not null then raise exception 'USE_INVESTOR_ACCOUNTS';end if;
  if old.investor_funded and (not new.investor_funded or new.purchase_price is distinct from old.purchase_price or new.investor_id is distinct from old.investor_id or new.investor_split is distinct from old.investor_split or new.consignment is distinct from old.consignment or new.outgoing_consignment is distinct from old.outgoing_consignment) then raise exception 'FUNDING_AGREEMENT_LOCKED';end if;
 end if;
 return new;
end $$;

create function public.uc_investor_bank_opening() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare bank_account text:='acct-bank-uc-'||md5('bank:'||new.id::text);
begin
 insert into ledger_accounts(id,name,type,investor_tagged) values(bank_account,new.name,'asset',null);
 if new.opening_cents>0 then
  perform uc_post_journal('opening:'||new.id::text,new.opening_date,'Bank opening balance',null,new.created_by,
   jsonb_build_array(jsonb_build_object('accountId',bank_account,'debit',new.opening_cents::numeric/100,'credit',0),jsonb_build_object('accountId','acct-equity','debit',0,'credit',new.opening_cents::numeric/100)));
 end if;
 return new;
end $$;
create trigger uc_bank_opening_to_journal after insert on public.uc_investor_banks for each row execute function public.uc_investor_bank_opening();
-- AFTER insert ensures the source-row guard can see the approved funding row.
create trigger uc_mark_funded_car after insert on public.uc_investor_cars for each row execute function public.uc_funded_car_guard();
create trigger uc_keep_funding_agreement before insert or update on public.cars for each row execute function public.uc_funded_car_guard();

insert into public.ledger_accounts(id,name,type,investor_tagged) values
 ('acct-uc-sale-clearing','Investor car sale money awaiting profit review','liability',true)
 on conflict(id) do nothing;

create or replace function public.uc_post_journal(p_id text,p_date date,p_description text,p_car text,p_actor text,p_lines jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare old_flag text; debit_total numeric;credit_total numeric;
begin
 select sum((x->>'debit')::numeric),sum((x->>'credit')::numeric) into debit_total,credit_total from jsonb_array_elements(p_lines) x;
 if debit_total is null or debit_total<>credit_total or debit_total<=0 or exists(select 1 from jsonb_array_elements(p_lines) x where (x->>'debit')::numeric<0 or (x->>'credit')::numeric<0 or ((x->>'debit')::numeric>0 and (x->>'credit')::numeric>0)) then raise exception 'UNBALANCED_INVESTOR_JOURNAL';end if;
 old_flag:=current_setting('autodream.uc_posting',true);
 perform set_config('autodream.uc_posting','on',true);
 insert into journal_entries(id,date,description,lines,source_type,source_id,car_id,created_by)
 values('uc:'||p_id,p_date,p_description,p_lines,'investor_finance',p_id,p_car,p_actor);
 perform set_config('autodream.uc_posting',coalesce(old_flag,''),true);
end $$;

create or replace function public.uc_investor_post_event() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare amount numeric;bank_id text;d text;c text;lines jsonb;label text;
begin
 if TG_TABLE_NAME='uc_investor_cash_entries' then
  -- A pot-to-company profit allocation changes ownership, not the bank.
  -- Its income/liability posting is included in the single settlement entry.
  if new.kind='company_profit' then return new;end if;
  amount:=abs(new.amount_cents)::numeric/100;
  bank_id:='acct-bank-uc-'||md5(new.bank_account);
  insert into ledger_accounts(id,name,type,investor_tagged) values(bank_id,'Bank account '||right(new.bank_account,8),'asset',null) on conflict(id) do nothing;
  if new.kind='capital_in' then d:=bank_id;c:='acct-investor-payable';label:='Investor money received';
  elsif new.kind='withdrawal_out' then d:='acct-investor-payable';c:=bank_id;label:='Investor withdrawal paid';
  elsif new.kind='car_purchase' then d:='acct-inv-investor';c:=bank_id;label:='Investor car purchase paid';
  elsif new.kind='car_expense' then d:='acct-ap';c:=bank_id;label:='Investor car bill paid';
  elsif new.kind='car_sale' then d:=bank_id;c:='acct-uc-sale-clearing';label:='Investor car sale money received';
  else raise exception 'INVALID_INVESTOR_CASH_KIND';end if;
  lines:=jsonb_build_array(jsonb_build_object('accountId',d,'debit',amount,'credit',0),jsonb_build_object('accountId',c,'debit',0,'credit',amount));
  perform uc_post_journal(new.id::text,new.paid_on,label,new.car_id,new.recorded_by,lines);
 elsif TG_TABLE_NAME='uc_investor_car_bills' then
  if new.state='approved' and old.state='pending' then
   d:='acct-inv-investor';c:='acct-ap';label:='Investor car bill approved';
  elsif new.state='voided' and old.state='approved' then
   d:='acct-ap';c:='acct-inv-investor';label:='Investor car bill cancelled';
  else return new;end if;
  amount:=new.amount_cents::numeric/100;
  perform uc_post_journal('bill:'||new.id||':'||new.state,(new.reviewed_at at time zone 'Asia/Kuala_Lumpur')::date,label,new.car_id,new.reviewed_by,
   jsonb_build_array(jsonb_build_object('accountId',d,'debit',amount,'credit',0),jsonb_build_object('accountId',c,'debit',0,'credit',amount)));
 else
  -- Principal and direct costs are recovered first. Only the investor's net
  -- result changes capital payable; the company receives no loss posting.
  lines:=jsonb_build_array(
   jsonb_build_object('accountId','acct-uc-sale-clearing','debit',new.sale_cents::numeric/100,'credit',0),
   jsonb_build_object('accountId','acct-inv-investor','debit',0,'credit',(new.purchase_cents+new.cost_cents)::numeric/100));
  if new.investor_result_cents<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-investor-payable','debit',greatest(0,-new.investor_result_cents)::numeric/100,'credit',greatest(0,new.investor_result_cents)::numeric/100));end if;
  if new.company_profit_cents>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-rev-investor-share','debit',0,'credit',new.company_profit_cents::numeric/100));end if;
  perform uc_post_journal('settlement:'||new.car_id,(new.approved_at at time zone 'Asia/Kuala_Lumpur')::date,'Investor car profit confirmed',new.car_id,new.approved_by,lines);
 end if;
 return new;
end $$;
create trigger uc_cash_to_journal after insert on public.uc_investor_cash_entries for each row execute function public.uc_investor_post_event();
create trigger uc_bill_to_journal after update on public.uc_investor_car_bills for each row execute function public.uc_investor_post_event();
create trigger uc_settlement_to_journal after insert on public.uc_investor_car_settlements for each row execute function public.uc_investor_post_event();

create or replace function public.uc_protect_financial_posting() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if TG_TABLE_NAME='journal_entries' then
  if TG_OP<>'INSERT' then
   if old.source_type='investor_finance' then raise exception 'INVESTOR_JOURNAL_IMMUTABLE';end if;
  end if;
 end if;
 if TG_OP='DELETE' then return old;end if;
 if TG_TABLE_NAME='journal_entries' then
  if new.source_type='investor_finance' then
   if current_setting('autodream.uc_posting',true) is distinct from 'on' then raise exception 'INVESTOR_POSTING_PRIVATE';end if;
   return new;
  end if;
  if exists(select 1 from jsonb_array_elements(new.lines) l where l->>'accountId' in ('acct-investor-payable','acct-inv-investor','acct-rev-investor-share','acct-uc-sale-clearing')) then raise exception 'USE_INVESTOR_POSTING';end if;
 end if;
 if new.car_id is not null then
  -- Serialize against fund_car's source-car lock, including when this
  -- transaction started before the funding agreement became visible.
  perform 1 from cars where id=new.car_id for update;
  if exists(select 1 from uc_investor_cars where car_id=new.car_id) then raise exception 'USE_INVESTOR_CAR_BILLS';end if;
 end if;
 return new;
end $$;
create trigger uc_no_duplicate_journal before insert or update or delete on public.journal_entries for each row execute function public.uc_protect_financial_posting();
create trigger uc_no_duplicate_payment before insert or update on public.payments for each row execute function public.uc_protect_financial_posting();
create trigger uc_journal_no_truncate before truncate on public.journal_entries execute function public.uc_investor_immutable();

revoke all on function public.uc_funded_car_guard(),public.uc_post_journal(text,date,text,text,text,jsonb),public.uc_investor_bank_opening(),public.uc_investor_post_event(),public.uc_protect_financial_posting() from public,anon,authenticated,service_role;
commit;
