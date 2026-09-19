CREATE TABLE IF NOT EXISTS team_overrides (
	team_number TEXT NOT NULL,
	season TEXT NOT NULL,
	field TEXT NOT NULL,
	value TEXT NOT NULL,
	updated_by TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (team_number, season, field)
);

CREATE INDEX IF NOT EXISTS idx_team_overrides_lookup
	ON team_overrides (team_number, season);
