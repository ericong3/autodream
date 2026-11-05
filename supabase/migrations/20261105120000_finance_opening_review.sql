-- PREPARED ONLY. Carry existing bank ledger into registered accounts without
-- adding it a second time or calling unexplained cash owner's equity.
begin;
insert into ledger_accounts(id,name,type) values('acct-opening-review','Opening balance waiting for review','equity') on conflict(id) do nothing;
create table uc_bank_opening_reviews(bank_id uuid primary key references uc_investor_banks(id),opening_date date not null,statement_cents bigint not null,legacy_bank_cents bigint not null,difference_cents bigint not null,recorded_by text not null references garage_building_staff(id),recorded_at timestamptz not null default now(),check(difference_cents=statement_cents-legacy_bank_cents));
alter table uc_bank_opening_reviews enable row level security;
revoke all on uc_bank_opening_reviews from public,anon,authenticated,service_role;
create trigger uc_bank_opening_reviews_fixed before update or delete on uc_bank_opening_reviews for each row execute function uc_investor_immutable();
create trigger uc_bank_opening_reviews_no_truncate before truncate on uc_bank_opening_reviews execute function uc_investor_immutable();
create or replace function uc_investor_bank_opening() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare account text:='acct-bank-uc-'||md5('bank:'||new.id::text);legacy bigint;difference bigint;lines jsonb:='[]'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('company-trade-in-funding',0));
 insert into ledger_accounts(id,name,type,investor_tagged) values(account,new.name,'asset',null);
 if exists(select 1 from uc_bank_opening_reviews) then legacy:=0;else
 select coalesce(sum(round(((l->>'debit')::numeric-(l->>'credit')::numeric)*100)),0)::bigint into legacy from journal_entries j cross join lateral jsonb_array_elements(j.lines) l where not coalesce(j.voided,false) and j.date<=new.opening_date and l->>'accountId'='acct-bank-operating';end if;
 difference:=new.opening_cents-legacy;
 if new.opening_cents>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId',account,'debit',new.opening_cents::numeric/100,'credit',0));end if;
 if legacy<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-bank-operating','debit',greatest(-legacy,0)::numeric/100,'credit',greatest(legacy,0)::numeric/100));end if;
 if difference<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('accountId','acct-opening-review','debit',greatest(-difference,0)::numeric/100,'credit',greatest(difference,0)::numeric/100));end if;
 if jsonb_array_length(lines)>0 then perform uc_post_journal('opening:'||new.id::text,new.opening_date,'Registered bank opening; old bank cleared, difference awaits statement review',null,new.created_by,lines);end if;
 insert into uc_bank_opening_reviews values(new.id,new.opening_date,new.opening_cents,legacy,difference,new.created_by,now());
 return new;
end $$;
alter function uc_company_bank_money(text,text,jsonb) rename to uc_bank_money_before_opening_review;
create function uc_company_bank_money(p_actor text,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 result:=uc_bank_money_before_opening_review(p_actor,p_action,p_data);
 if p_action='banks' then return result||jsonb_build_object('openingReview',jsonb_build_object('bankMatched',false,'legacyTransferredCents',(select coalesce(sum(legacy_bank_cents),0) from uc_bank_opening_reviews),'differenceCents',(select coalesce(sum(difference_cents),0) from uc_bank_opening_reviews),'note','Starting balances are not bank reconciliation. Differences remain for later review.'));end if;
 return result;
end $$;
create function uc_registered_bank_only_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if exists(select 1 from uc_investor_banks) and (tg_op='INSERT' or new.lines is distinct from old.lines) and exists(select 1 from jsonb_array_elements(new.lines) l where l->>'accountId' in ('acct-bank-operating','acct-bank-investor')) and not coalesce(new.source_type='investor_finance' and current_setting('autodream.uc_posting',true)='on',false) then raise exception 'USE_REGISTERED_BANK';end if;return new;end $$;
create trigger uc_registered_bank_only before insert or update on journal_entries for each row execute function uc_registered_bank_only_guard();
revoke all on function uc_registered_bank_only_guard() from public,anon,authenticated,service_role;
revoke all on function uc_investor_bank_opening(),uc_bank_money_before_opening_review(text,text,jsonb),uc_company_bank_money(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function uc_company_bank_money(text,text,jsonb) to service_role;
commit;
