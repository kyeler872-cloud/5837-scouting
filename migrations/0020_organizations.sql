CREATE TABLE IF NOT EXISTS organizations (
	id TEXT PRIMARY KEY NOT NULL,
	clerk_organization_id TEXT UNIQUE,
	name TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	created_by_user_id TEXT
);

INSERT INTO organizations (id, name)
VALUES ('waterloo-robotics', 'Waterloo Robotics')
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS organization_teams (
	organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	league TEXT NOT NULL CHECK (league IN ('FTC', 'FRC')),
	team_number TEXT NOT NULL,
	PRIMARY KEY (organization_id, league, team_number)
);

INSERT INTO organization_teams (organization_id, league, team_number) VALUES
	('waterloo-robotics', 'FRC', '5837'),
	('waterloo-robotics', 'FTC', '7247'),
	('waterloo-robotics', 'FTC', '5445')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS organization_memberships (
	user_id TEXT PRIMARY KEY NOT NULL,
	organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('student', 'mentor')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS organization_memberships_org_idx
	ON organization_memberships (organization_id, role, created_at);

CREATE TABLE IF NOT EXISTS organization_join_codes (
	organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	code TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_access_requests (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	organization_name TEXT NOT NULL,
	email TEXT NOT NULL,
	role TEXT NOT NULL CHECK (role IN ('student', 'mentor')),
	message TEXT NOT NULL DEFAULT '',
	team_numbers TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
	organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS organization_access_requests_status_idx
	ON organization_access_requests (status, created_at);

CREATE TABLE IF NOT EXISTS organization_email_whitelist (
	email TEXT PRIMARY KEY NOT NULL,
	organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('student', 'mentor')),
	added_by_user_id TEXT NOT NULL,
	added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE team_overrides_scoped (
	organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	team_number TEXT NOT NULL,
	season TEXT NOT NULL,
	field TEXT NOT NULL,
	value TEXT NOT NULL,
	updated_by TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_by_first_name TEXT,
	updated_by_last_initial TEXT,
	updated_by_account_name TEXT,
	PRIMARY KEY (organization_id, team_number, season, field)
);

INSERT INTO team_overrides_scoped (
	organization_id, team_number, season, field, value, updated_by, updated_at,
	updated_by_first_name, updated_by_last_initial, updated_by_account_name
)
SELECT 'waterloo-robotics', team_number, season, field, value, updated_by, updated_at,
	updated_by_first_name, updated_by_last_initial, updated_by_account_name
FROM team_overrides;

DROP TABLE team_overrides;
ALTER TABLE team_overrides_scoped RENAME TO team_overrides;

CREATE INDEX idx_team_overrides_lookup
	ON team_overrides (organization_id, team_number, season);

CREATE TABLE event_notes_scoped (
	organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	league TEXT NOT NULL,
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	category TEXT NOT NULL,
	note TEXT NOT NULL DEFAULT '',
	updated_by TEXT NOT NULL,
	updated_by_account_name TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (organization_id, league, season, event_code, category)
);

INSERT INTO event_notes_scoped (
	organization_id, league, season, event_code, category, note, updated_by, updated_by_account_name, updated_at
)
SELECT 'waterloo-robotics', league, season, event_code, category, note, updated_by, updated_by_account_name, updated_at
FROM event_notes;

DROP TABLE event_notes;
ALTER TABLE event_notes_scoped RENAME TO event_notes;

ALTER TABLE event_match_scouting_notes
	ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'waterloo-robotics';

ALTER TABLE event_match_scouting
	ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'waterloo-robotics';

CREATE INDEX IF NOT EXISTS event_match_scouting_notes_org_idx
	ON event_match_scouting_notes (organization_id, league, season, event_code, match_key, phase);
