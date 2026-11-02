CREATE TABLE IF NOT EXISTS event_match_scouting_notes (
	id TEXT PRIMARY KEY,
	league TEXT NOT NULL,
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	match_key TEXT NOT NULL,
	phase TEXT NOT NULL CHECK (phase IN ('Auto', 'TeleOp', 'Endgame')),
	note TEXT NOT NULL,
	contributor_id TEXT NOT NULL,
	contributor_name TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS event_match_scouting_notes_event_match_idx
	ON event_match_scouting_notes (league, season, event_code, match_key, phase, created_at);

INSERT INTO event_match_scouting_notes
	(id, league, season, event_code, match_key, phase, note, contributor_id, contributor_name, created_at)
SELECT lower(hex(randomblob(16))), league, season, event_code, match_key, phase, note, updated_by, updated_by_account_name, updated_at
FROM event_match_scouting
WHERE note <> '';
