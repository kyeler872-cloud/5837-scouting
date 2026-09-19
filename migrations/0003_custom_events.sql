CREATE TABLE IF NOT EXISTS custom_events (
	team_number TEXT NOT NULL,
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	event_name TEXT NOT NULL,
	created_by TEXT NOT NULL,
	created_by_first_name TEXT,
	created_by_last_initial TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (team_number, season, event_code)
);
