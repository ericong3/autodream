-- Investor car money: the bank date wins over when things were keyed in the app.
--
-- A car is normally added to the app (and put on an investor's account) after
-- the money has already moved, so a car that falls through never has to be
-- added and deleted. The old rule refused any purchase payment, car bill
-- payment or sale money dated before the car was put on the investor account,
-- before the sale price was agreed in the app, or before the bill was reviewed.
-- That refused the real bank date (e.g. AMF4246: paid 17 Nov, added later).
--
-- What still holds: the car must be on the investor account, the sale agreed and
-- the bill reviewed BEFORE the payment can be recorded; the date cannot be in
-- the future; dates before the bank's opening day keep their own path; invoice
-- and bank slip are still required.
begin;
do $$ declare src text;patched text;s text;begin
 src:=pg_get_functiondef('public.uc_investor_capital_phase2(text,text,jsonb)'::regprocedure);
 patched:=src;
 foreach s in array array[
  'if day<(car.approved_at at time zone ''Asia/Kuala_Lumpur'')::date then raise exception ''PAYMENT_BEFORE_APPROVAL'';end if;',
  'if p_action=''sale_received'' and day<(car.sale_approved_at at time zone ''Asia/Kuala_Lumpur'')::date then raise exception ''PAYMENT_BEFORE_APPROVAL'';end if;',
  'if p_action=''pay_car_bill'' and day<(bill.reviewed_at at time zone ''Asia/Kuala_Lumpur'')::date then raise exception ''PAYMENT_BEFORE_APPROVAL'';end if;'
 ] loop
  if (length(patched)-length(replace(patched,s,'')))/length(s)<>1 then raise exception 'PATCH_NOT_APPLIED: %',left(s,60);end if;
  patched:=replace(patched,s,'/* dated by the bank, not by when it was keyed in the app */');
 end loop;
 if position('FUTURE_PAYMENT' in patched)=0 then raise exception 'PATCH_NOT_APPLIED: future check missing';end if;
 execute patched;
end $$;
commit;
