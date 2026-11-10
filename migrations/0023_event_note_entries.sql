CREATE TABLE IF NOT EXISTS event_note_entries (
	id TEXT PRIMARY KEY NOT NULL,
	organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	league TEXT NOT NULL CHECK (league IN ('FTC', 'FRC')),
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	category TEXT NOT NULL CHECK (category IN ('Matches', 'Playoffs', 'Notes')),
	note TEXT NOT NULL,
	contributor_id TEXT NOT NULL,
	contributor_name TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS event_note_entries_event_idx
	ON event_note_entries (organization_id, league, season, event_code, category, created_at);

INSERT INTO event_note_entries (
	id, organization_id, league, season, event_code, category, note, contributor_id, contributor_name, created_at
)
SELECT lower(hex(randomblob(16))), organization_id, league, season, event_code, category, note,
	updated_by, updated_by_account_name, updated_at
FROM event_notes
WHERE trim(note) <> '';
