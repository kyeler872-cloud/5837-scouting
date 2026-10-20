CREATE TABLE IF NOT EXISTS team_social_links (
	league TEXT NOT NULL,
	team_number TEXT NOT NULL,
	platform TEXT NOT NULL,
	value TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (league, team_number, platform)
);
