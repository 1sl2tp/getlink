-- GETLINK supplier catalog source of truth:
-- Supabase reads the central management workbook only.
-- NCC files are synchronized with management outside this ingest path.

update public.getlink_supplier_sources
set
  spreadsheet_id='1hGqAzIEqTMmULIeh5sCmed2R3XaiA9QZavtGRdNvyyU',
  sheet_name=case source_key
    when 'hang-u' then 'Hàng U'
    when 'thuoc-la' then 'Thuốc lá'
    when 'sua' then 'Sữa'
    when 'masan' then 'Hàng masan'
    when 'hang-thuong' then 'Hàng thường'
    else sheet_name
  end,
  sheet_gid=case source_key
    when 'hang-u' then 305224020
    when 'thuoc-la' then 583030487
    when 'sua' then 1822935945
    when 'masan' then 1608078911
    when 'hang-thuong' then 1330446015
    else sheet_gid
  end,
  updated_at=now()
where source_key in ('hang-u','thuoc-la','sua','masan','hang-thuong');

select cron.alter_job(
  job_id := (
    select jobid
    from cron.job
    where jobname='getlink-supplier-sheet-sync'
    limit 1
  ),
  schedule := '*/5 * * * *',
  active := true
);
