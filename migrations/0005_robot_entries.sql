CREATE TABLE IF NOT EXISTS robot_entries (
	id TEXT PRIMARY KEY,
	team_number TEXT NOT NULL,
	season TEXT NOT NULL,
	name TEXT NOT NULL,
	description TEXT NOT NULL,
	image_urls TEXT NOT NULL DEFAULT '[]',
	start_month TEXT NOT NULL,
	end_month TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_robot_entries_team_season
	ON robot_entries (team_number, season, end_month, start_month);
