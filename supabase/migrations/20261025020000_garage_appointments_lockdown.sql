-- Apply only after the API-backed Calendar client is live. Existing records are kept.
revoke all on public.garage_appointments from public,anon,authenticated;
