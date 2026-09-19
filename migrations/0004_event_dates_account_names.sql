ALTER TABLE team_overrides ADD COLUMN updated_by_account_name TEXT;
ALTER TABLE selected_events ADD COLUMN added_by_account_name TEXT;
ALTER TABLE custom_events ADD COLUMN created_by_account_name TEXT;
ALTER TABLE custom_events ADD COLUMN event_date TEXT;
