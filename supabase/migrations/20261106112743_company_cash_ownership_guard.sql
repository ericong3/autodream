-- Company payments cannot consume investor-owned bank money.
-- PREPARED ONLY. Uses the same outer lock as funding and investor actions.
begin;
alter function uc_company_bank_money(text,text,jsonb) rename to uc_bank_money_before_ownership_guard;
create function uc_company_bank_money(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;position jsonb;begin
 if p_action='record' then perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));end if;
 result:=uc_bank_money_before_ownership_guard(p_actor,p_action,p_data);
 if p_action='record' then
  position:=uc_company_cash_position();
  -- Pending bills are reserves, not additional physical cash. Checking
  -- availableCents here would reject ordinary partial payments whenever
  -- total unpaid bills exceed cash. The ownership floor must still hold.
  if (position->>'companyCashCents')::bigint-coalesce((position->>'companyOwesInvestorCents')::bigint,0)<0 then raise exception 'COMPANY_FUNDS_REQUIRED';end if;
 end if;
 return result;
end $$;
revoke all on function uc_bank_money_before_ownership_guard(text,text,jsonb),uc_company_bank_money(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_company_bank_money(text,text,jsonb) to service_role;
commit;
