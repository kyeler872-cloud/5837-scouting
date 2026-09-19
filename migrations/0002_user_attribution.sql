ALTER TABLE team_overrides ADD COLUMN updated_by_first_name TEXT;
ALTER TABLE team_overrides ADD COLUMN updated_by_last_initial TEXT;

CREATE TABLE IF NOT EXISTS selected_events (
	team_number TEXT NOT NULL,
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	event_name TEXT NOT NULL,
	added_by TEXT NOT NULL,
	added_by_first_name TEXT,
	added_by_last_initial TEXT,
	added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (team_number, season, event_code)
);
