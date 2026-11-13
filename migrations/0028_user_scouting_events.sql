CREATE TABLE IF NOT EXISTS user_scouting_events (
	user_id TEXT NOT NULL,
	league TEXT NOT NULL CHECK (league IN ('FTC', 'FRC')),
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id, league, season, event_code)
);
