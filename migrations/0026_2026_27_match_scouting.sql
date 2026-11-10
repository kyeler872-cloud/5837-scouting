CREATE TABLE IF NOT EXISTS event_match_2026_scouting (
	organization_id TEXT NOT NULL,
	league TEXT NOT NULL CHECK (league = 'FTC'),
	season TEXT NOT NULL CHECK (season = '2026'),
	event_code TEXT NOT NULL,
	match_key TEXT NOT NULL,
	team_number TEXT NOT NULL,
	flower INTEGER CHECK (flower IS NULL OR (flower >= 0 AND flower <= 10000)),
	pollen INTEGER CHECK (pollen IS NULL OR (pollen >= 0 AND pollen <= 10000)),
	alliance_tips INTEGER CHECK (alliance_tips IS NULL OR (alliance_tips >= 0 AND alliance_tips <= 10000)),
	alliance_auto_points INTEGER CHECK (alliance_auto_points IS NULL OR (alliance_auto_points >= 0 AND alliance_auto_points <= 10000)),
	additional_notes TEXT NOT NULL DEFAULT '',
	updated_by TEXT NOT NULL,
	updated_by_account_name TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (organization_id, league, season, event_code, match_key, team_number)
);

CREATE INDEX IF NOT EXISTS event_match_2026_scouting_event_idx
	ON event_match_2026_scouting (organization_id, league, season, event_code, match_key);
