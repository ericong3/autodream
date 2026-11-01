begin;
do $$ begin
 perform 1 from used_car_bonus_campaigns where id='3950ac75-1bc0-4f91-a894-3eb25615883c' for update;
 if not exists(select 1 from used_car_bonus_campaigns where id='3950ac75-1bc0-4f91-a894-3eb25615883c' and minimum_units=6 and amount_per_unit=500 and revision=2 and published_at is not null and start_month='2026-10' and end_month='2026-12') then raise exception 'STOP: Published campaign changed. Review correction first.';end if;
 if exists(select 1 from used_car_bonus_months where campaign_id='3950ac75-1bc0-4f91-a894-3eb25615883c') then raise exception 'STOP: Campaign has confirmed results. Do not rewrite history.';end if;
end $$;
create temporary table bonus_correction_before on commit drop as select to_jsonb(c) campaign from used_car_bonus_campaigns c where id='3950ac75-1bc0-4f91-a894-3eb25615883c';
-- Follow existing director-assigned commission credit months. Confirmed results stay frozen.
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='cars' and column_name='commission_credited_early')
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='cars' and column_name='commission_credited_month') then raise exception 'STOP: Existing early commission setup is missing.';end if;
 if replace((select prosrc from pg_proc where oid='public.used_car_bonus_preview(uuid,text)'::regprocedure),E'\r\n',E'\n') is distinct from replace($reviewed_bonus_baseline$
declare campaign used_car_bonus_campaigns;result jsonb;cars_json jsonb;issues jsonb;units integer;people integer;pool numeric;cents bigint;
begin
 select * into campaign from used_car_bonus_campaigns where id=p_campaign;
 if campaign.id is null or p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_month not between campaign.start_month and campaign.end_month then raise exception 'INVALID';end if;
 select snapshot||jsonb_build_object('confirmed',true,'confirmedAt',confirmed_at) into result from used_car_bonus_months where campaign_id=p_campaign and month=p_month;
 if found then return result;end if;
 -- Use actual handover dates in Malaysia, never intake/deal-paperwork dates or
 -- commission credited early. One car counts once, even with duplicate leads.
 with deliveries as (
  select c.id,concat_ws(' · ',c.car_plate,c.make,c.model) label,c.status,
   (select min(cu.delivered_at::timestamptz) from customers cu where cu.interested_car_id=c.id and cu.delivered=true and cu.delivered_at is not null) handed_over
  from cars c where (c.consignment is null or c.consignment='null'::jsonb) and (c.outgoing_consignment is null or c.outgoing_consignment='null'::jsonb)
 ), relevant as (
  select *,to_char(handed_over at time zone 'Asia/Kuala_Lumpur','YYYY-MM') delivery_month from deliveries
 ) select
  coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label) order by id) filter(where status='delivered' and delivery_month=p_month),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'reason',case when handed_over is null then 'Missing customer handover date' else 'Customer says delivered; car is not delivered' end) order by id)
   filter(where (status='delivered' and handed_over is null) or (status<>'delivered' and delivery_month=p_month)),'[]'::jsonb)
  into cars_json,issues from relevant;
 units:=jsonb_array_length(cars_json);
 select count(*) into people from used_car_bonus_enrolments where campaign_id=p_campaign;
 if people=0 then raise exception 'INVALID_ENROLMENT';end if;
 pool:=case when units>=campaign.minimum_units then units*campaign.amount_per_unit else 0 end;cents:=round(pool*100)::bigint;
 result:=jsonb_build_object('campaignId',p_campaign,'month',p_month,'units',units,'minimumUnits',campaign.minimum_units,
  'pool',pool,'qualified',units>=campaign.minimum_units,'confirmed',false,'cars',cars_json,'issues',issues,
  'rule',jsonb_build_object('title',campaign.title,'minimumUnits',campaign.minimum_units,'amountPerUnit',campaign.amount_per_unit,'revision',campaign.revision),
  'shares',(select jsonb_agg(jsonb_build_object('id',staff_id,'name',name,'amount',((cents/people)+case when n<=mod(cents,people) then 1 else 0 end)::numeric/100) order by staff_id)
   from (select staff_id,name,row_number() over(order by staff_id) n from used_car_bonus_enrolments where campaign_id=p_campaign) x));
 return result||jsonb_build_object('previewHash',md5(result::text));
end $reviewed_bonus_baseline$,E'\r\n',E'\n') then raise exception 'STOP: Bonus preview changed. Review before replacing.';end if;
end $$;
create or replace function public.used_car_bonus_preview(p_campaign uuid,p_month text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare campaign used_car_bonus_campaigns;result jsonb;cars_json jsonb;issues jsonb;units integer;people integer;pool numeric;cents bigint;
begin
 select * into campaign from used_car_bonus_campaigns where id=p_campaign;
 if campaign.id is null or p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_month not between campaign.start_month and campaign.end_month then raise exception 'INVALID';end if;
 select snapshot||jsonb_build_object('confirmed',true,'confirmedAt',confirmed_at) into result from used_car_bonus_months where campaign_id=p_campaign and month=p_month;
 if found then return result;end if;
 -- The director's Credit Commission Early month takes precedence over handover.
 -- One row per company-owned car prevents duplicate leads or later delivery counting twice.
 with deliveries as (
  select c.id,concat_ws(' · ',c.car_plate,c.make,c.model) label,c.status,
   coalesce(c.commission_credited_early,false) early_credit,c.commission_credited_month credit_month,
   (select min(cu.delivered_at::timestamptz) from customers cu where cu.interested_car_id=c.id and cu.delivered=true and cu.delivered_at is not null) handed_over
  from cars c where (c.consignment is null or c.consignment='null'::jsonb) and (c.outgoing_consignment is null or c.outgoing_consignment='null'::jsonb)
   and not exists(select 1 from used_car_bonus_months b where b.campaign_id=p_campaign and b.month<>p_month and b.snapshot->'cars' @> jsonb_build_array(jsonb_build_object('id',c.id)))
 ), relevant as (
  select *,to_char(handed_over at time zone 'Asia/Kuala_Lumpur','YYYY-MM') delivery_month,
   coalesce(credit_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$',false) valid_credit_month,
   case when early_credit then credit_month else to_char(handed_over at time zone 'Asia/Kuala_Lumpur','YYYY-MM') end qualifying_month
  from deliveries
 ) select
  coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'basis',case when early_credit then 'early_credit' else 'delivery' end,'creditedMonth',qualifying_month) order by id)
   filter(where qualifying_month=p_month and ((early_credit and valid_credit_month) or (not early_credit and status='delivered'))),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'reason',case when early_credit then 'Credit Commission Early needs a valid credited month' when handed_over is null then 'Missing customer handover date' else 'Customer says delivered; car is not delivered' end) order by id)
   filter(where (early_credit and not valid_credit_month) or (not early_credit and ((status='delivered' and handed_over is null) or (status<>'delivered' and delivery_month=p_month)))),'[]'::jsonb)
  into cars_json,issues from relevant;
 units:=jsonb_array_length(cars_json);
 select count(*) into people from used_car_bonus_enrolments where campaign_id=p_campaign;
 if people=0 then raise exception 'INVALID_ENROLMENT';end if;
 pool:=case when units>=campaign.minimum_units then units*campaign.amount_per_unit else 0 end;cents:=round(pool*100)::bigint;
 result:=jsonb_build_object('campaignId',p_campaign,'month',p_month,'units',units,'minimumUnits',campaign.minimum_units,
  'pool',pool,'qualified',units>=campaign.minimum_units,'confirmed',false,'cars',cars_json,'issues',issues,
  'rule',jsonb_build_object('title',campaign.title,'minimumUnits',campaign.minimum_units,'amountPerUnit',campaign.amount_per_unit,'revision',campaign.revision,'unitTiming','commission_credit_or_delivery'),
  'shares',(select jsonb_agg(jsonb_build_object('id',staff_id,'name',name,'amount',((cents/people)+case when n<=mod(cents,people) then 1 else 0 end)::numeric/100) order by staff_id)
   from (select staff_id,name,row_number() over(order by staff_id) n from used_car_bonus_enrolments where campaign_id=p_campaign) x));
 return result||jsonb_build_object('previewHash',md5(result::text));
end $$;
revoke all on function public.used_car_bonus_preview(uuid,text) from public,anon,authenticated;
notify pgrst,'reload schema';

update used_car_bonus_campaigns set minimum_units=5,revision=revision+1 where id='3950ac75-1bc0-4f91-a894-3eb25615883c';
insert into used_car_data_repairs(id,reason,before_state,after_state)
select 'bonus-five-target-early-credit-20261101','Owner corrected target to 5 and instructed bonus units to follow existing Credit Commission Early months. No car statuses, credit flags, payments or confirmed results changed.',campaign,(select to_jsonb(c) from used_car_bonus_campaigns c where id='3950ac75-1bc0-4f91-a894-3eb25615883c') from bonus_correction_before;
commit;
select used_car_bonus_campaign('1775830371686-07v0clknm','preview','{"id":"3950ac75-1bc0-4f91-a894-3eb25615883c","month":"2026-10"}') october;
