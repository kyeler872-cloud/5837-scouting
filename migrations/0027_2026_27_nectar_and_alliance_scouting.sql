ALTER TABLE event_match_2026_scouting
	ADD COLUMN nectar INTEGER CHECK (nectar IS NULL OR (nectar >= 0 AND nectar <= 10000));

CREATE TABLE IF NOT EXISTS event_match_2026_alliance_scouting (
	organization_id TEXT NOT NULL,
	league TEXT NOT NULL CHECK (league = 'FTC'),
	season TEXT NOT NULL CHECK (season = '2026'),
	event_code TEXT NOT NULL,
	match_key TEXT NOT NULL,
	alliance TEXT NOT NULL CHECK (alliance IN ('red', 'blue')),
	alliance_tips INTEGER CHECK (alliance_tips IS NULL OR (alliance_tips >= 0 AND alliance_tips <= 10000)),
	alliance_auto_points INTEGER CHECK (alliance_auto_points IS NULL OR (alliance_auto_points >= 0 AND alliance_auto_points <= 10000)),
	updated_by TEXT NOT NULL,
	updated_by_account_name TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (organization_id, league, season, event_code, match_key, alliance)
);
