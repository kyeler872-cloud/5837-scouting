CREATE TABLE IF NOT EXISTS event_match_auto_selections (
	league TEXT NOT NULL,
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	match_key TEXT NOT NULL,
	team_number TEXT NOT NULL,
	robot_id TEXT NOT NULL,
	auto_id TEXT NOT NULL,
	updated_by TEXT NOT NULL,
	updated_by_account_name TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (league, season, event_code, match_key, team_number)
);
