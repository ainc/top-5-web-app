grant usage on schema app_private to service_role;
grant execute on function app_private.task_slot_count() to service_role;
grant execute on function app_private.task_write_columns() to service_role;
grant execute on function app_private.log_scorecard_edit() to service_role;
grant execute on function app_private.reject_closed_season_write() to service_role;
