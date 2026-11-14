-- Round four 2TN consignment payouts to whole cents.
-- They were saved with fractions of a cent from the profit-split maths
-- (e.g. 6926.172000000005), which the money checks reject, so the 2TN dealer
-- page, the investment lock and paying them all failed.
-- Changes only these four rows, only if they still have sub-cent amounts.
-- All-or-nothing: if any guard refuses, nothing changes.
do $$
declare n int;
begin
 update payments set amount=round(amount,2)
 where id in ('1790833311826-chgt0z6mv','1792288396658-ufdj53k1h','1792288396659-8y9c1hb8x','1792288396659-1o78mdpky')
   and type='consignment_payout' and amount*100<>trunc(amount*100);
 get diagnostics n=row_count;
 if n<>4 then raise exception 'Expected to round 4 payouts, found %. Nothing was changed.',n; end if;
end $$;

select id, amount from payments
where id in ('1790833311826-chgt0z6mv','1792288396658-ufdj53k1h','1792288396659-8y9c1hb8x','1792288396659-1o78mdpky')
order by id;
