CREATE TABLE IF NOT EXISTS audit_logs (
	id TEXT PRIMARY KEY NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	user_id TEXT NOT NULL,
	account_name TEXT NOT NULL,
	email TEXT,
	action TEXT NOT NULL,
	target TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS logs_access_whitelist (
	id TEXT PRIMARY KEY NOT NULL,
	email TEXT,
	account_name TEXT,
	added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	added_by_user_id TEXT NOT NULL,
	CHECK (email IS NOT NULL OR account_name IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS logs_access_whitelist_email_idx
	ON logs_access_whitelist (lower(email)) WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS logs_access_whitelist_name_idx
	ON logs_access_whitelist (lower(account_name)) WHERE account_name IS NOT NULL;
