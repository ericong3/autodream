-- Private per-staff Kanban arrangements, separate from service/job status.
create table public.garage_enquiry_boards (
 owner_id text primary key references public.garage_building_staff(id) on delete restrict,
 preferences jsonb not null, revision integer not null default 1, updated_at timestamptz not null default now()
);
alter table public.garage_enquiry_boards enable row level security;
revoke all on public.garage_enquiry_boards from public,anon,authenticated;
create function public.garage_enquiry_board_action(p_actor text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff; saved garage_enquiry_boards; prefs jsonb; c jsonb; v jsonb; k text;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not actor.enabled or actor.registration_status<>'active' or actor.business_access not in ('garage','both') or actor.role not in ('director','shareholder','garage_head','garage_salesman') then raise exception 'NOT_ALLOWED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('garage-board:'||p_actor,0));
 select * into saved from garage_enquiry_boards where owner_id=p_actor for update;
 if p_action='get' then return jsonb_build_object('preferences',saved.preferences,'revision',coalesce(saved.revision,0)); end if;
 if p_action<>'save' then raise exception 'INVALID'; end if;
 if coalesce((p_data->>'revision')::integer,-1)<>coalesce(saved.revision,0) then raise exception 'REVISION_CONFLICT'; end if;
 prefs:=p_data->'preferences';
 if jsonb_typeof(prefs) is distinct from 'object' or length(prefs::text)>200000 then raise exception 'INVALID'; end if;
 if exists(select 1 from jsonb_object_keys(prefs) key where key not in ('mode','columns','products','personalPositions','standardPositions','personalOrder','standardOrder','pins')) then raise exception 'INVALID'; end if;
 if coalesce(prefs->>'mode','') not in ('standard','personal') or jsonb_typeof(prefs->'columns') is distinct from 'array' then raise exception 'INVALID'; end if;
 if jsonb_array_length(prefs->'columns')>20 then raise exception 'INVALID'; end if;
 for c in select value from jsonb_array_elements(prefs->'columns') loop
  if coalesce(c->>'id','')!~'^personal-[a-z0-9-]{1,64}$' or length(trim(coalesce(c->>'name',''))) not between 1 and 40 or coalesce(c->>'color','')!~'^#[a-fA-F0-9]{6}$' then raise exception 'INVALID'; end if;
 end loop;
 if (select count(*)<>count(distinct value->>'id') or count(*)<>count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(prefs->'columns')) then raise exception 'INVALID'; end if;
 if jsonb_typeof(prefs->'products') is distinct from 'array' then raise exception 'INVALID'; end if;
 if jsonb_array_length(prefs->'products')>5 or exists(select 1 from jsonb_array_elements_text(prefs->'products') x where x not in ('Tint','Coating','PPF','Spray','Building tint')) then raise exception 'INVALID'; end if;
 foreach k in array array['personalPositions','standardPositions'] loop
  if jsonb_typeof(prefs->k) is distinct from 'object' then raise exception 'INVALID'; end if;
  for c in select jsonb_build_object('key',key,'value',value) from jsonb_each(prefs->k) loop
   if length(c->>'key')>100 or jsonb_typeof(c->'value')<>'string' or length(c->>'value')>100 then raise exception 'INVALID'; end if;
   if not exists(select 1 from garage_enquiries where id=c->>'key' and (owner_id=p_actor or actor.role='director')) then raise exception 'NOT_ALLOWED'; end if;
   if k='standardPositions' and c->>'value' not in ('New','Follow up','Waiting for customer','Ready to book') then raise exception 'INVALID'; end if;
  end loop;
 end loop;
 foreach k in array array['personalOrder','standardOrder','pins'] loop
  if jsonb_typeof(prefs->k) is distinct from 'array' then raise exception 'INVALID'; end if;
  if jsonb_array_length(prefs->k)>5000 then raise exception 'INVALID'; end if;
  for v in select value from jsonb_array_elements(prefs->k) loop
   if jsonb_typeof(v)<>'string' or not exists(select 1 from garage_enquiries where id=v#>>'{}' and (owner_id=p_actor or actor.role='director')) then raise exception 'NOT_ALLOWED'; end if;
  end loop;
 end loop;
 insert into garage_enquiry_boards(owner_id,preferences,revision) values(p_actor,prefs,1)
 on conflict(owner_id) do update set preferences=excluded.preferences,revision=garage_enquiry_boards.revision+1,updated_at=now() returning * into saved;
 return jsonb_build_object('preferences',saved.preferences,'revision',saved.revision);
exception when invalid_text_representation then raise exception 'INVALID';
end $$;
revoke all on function public.garage_enquiry_board_action(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.garage_enquiry_board_action(text,text,jsonb) to service_role;
