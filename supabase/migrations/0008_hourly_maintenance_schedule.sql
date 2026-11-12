-- Runs the housekeeping function five minutes past every hour:
-- flags missed check-outs and starts or clears each company's over-limit warning period.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('iwill-hourly-maintenance', '5 * * * *', $$select private.hourly_maintenance()$$);
