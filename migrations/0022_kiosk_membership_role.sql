CREATE TABLE organization_memberships_new (
	user_id TEXT PRIMARY KEY NOT NULL,
	organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('student', 'mentor', 'kiosk')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO organization_memberships_new (user_id, organization_id, role, created_at)
	SELECT user_id, organization_id, role, created_at FROM organization_memberships;

DROP TABLE organization_memberships;
ALTER TABLE organization_memberships_new RENAME TO organization_memberships;

CREATE INDEX organization_memberships_org_idx
	ON organization_memberships (organization_id, role, created_at);

CREATE TABLE organization_email_whitelist_new (
	email TEXT PRIMARY KEY NOT NULL,
	organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('student', 'mentor', 'kiosk')),
	added_by_user_id TEXT NOT NULL,
	added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO organization_email_whitelist_new (email, organization_id, role, added_by_user_id, added_at)
	SELECT email, organization_id, role, added_by_user_id, added_at FROM organization_email_whitelist;

DROP TABLE organization_email_whitelist;
ALTER TABLE organization_email_whitelist_new RENAME TO organization_email_whitelist;
