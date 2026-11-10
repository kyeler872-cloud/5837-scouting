CREATE TABLE IF NOT EXISTS event_note_documents (
	id TEXT PRIMARY KEY NOT NULL,
	organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	league TEXT NOT NULL CHECK (league IN ('FTC', 'FRC')),
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	category TEXT NOT NULL CHECK (category IN ('Matches', 'Playoffs', 'Notes')),
	content TEXT NOT NULL DEFAULT '',
	attributions TEXT NOT NULL DEFAULT '[]',
	updated_by TEXT NOT NULL,
	updated_by_account_name TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (organization_id, league, season, event_code, category)
);

CREATE INDEX IF NOT EXISTS event_note_documents_event_idx
	ON event_note_documents (organization_id, league, season, event_code, category);

WITH ordered_entries AS (
	SELECT *,
		row_number() OVER (
			PARTITION BY organization_id, league, season, event_code, category
			ORDER BY created_at, id
		) AS sequence
	FROM event_note_entries
	WHERE trim(note) <> ''
),
grouped_entries AS (
	SELECT organization_id, league, season, event_code, category,
		group_concat(note, char(10)) AS content,
		json_group_array(json_object(
			'text', CASE WHEN sequence = 1 THEN note ELSE char(10) || note END,
			'contributorId', contributor_id,
			'contributorName', contributor_name
		)) AS attributions,
		max(created_at) AS updated_at
	FROM ordered_entries
	GROUP BY organization_id, league, season, event_code, category
)
INSERT INTO event_note_documents (
	id, organization_id, league, season, event_code, category, content, attributions,
	updated_by, updated_by_account_name, updated_at
)
SELECT lower(hex(randomblob(16))), grouped.organization_id, grouped.league, grouped.season,
	grouped.event_code, grouped.category, grouped.content, grouped.attributions,
	(SELECT contributor_id FROM ordered_entries latest
		WHERE latest.organization_id = grouped.organization_id AND latest.league = grouped.league
			AND latest.season = grouped.season AND latest.event_code = grouped.event_code
			AND latest.category = grouped.category
		ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1),
	(SELECT contributor_name FROM ordered_entries latest
		WHERE latest.organization_id = grouped.organization_id AND latest.league = grouped.league
			AND latest.season = grouped.season AND latest.event_code = grouped.event_code
			AND latest.category = grouped.category
		ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1),
	grouped.updated_at
FROM grouped_entries grouped;

INSERT INTO event_note_documents (
	id, organization_id, league, season, event_code, category, content, attributions,
	updated_by, updated_by_account_name, updated_at
)
SELECT lower(hex(randomblob(16))), legacy.organization_id, legacy.league, legacy.season,
	legacy.event_code, legacy.category, legacy.note,
	json_array(json_object(
		'text', legacy.note,
		'contributorId', legacy.updated_by,
		'contributorName', legacy.updated_by_account_name
	)),
	legacy.updated_by, legacy.updated_by_account_name, legacy.updated_at
FROM event_notes legacy
WHERE trim(legacy.note) <> ''
	AND NOT EXISTS (
		SELECT 1 FROM event_note_documents document
		WHERE document.organization_id = legacy.organization_id AND document.league = legacy.league
			AND document.season = legacy.season AND document.event_code = legacy.event_code
			AND document.category = legacy.category
	);
