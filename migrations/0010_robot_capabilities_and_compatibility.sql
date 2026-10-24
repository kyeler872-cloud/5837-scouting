ALTER TABLE robot_entries
	ADD COLUMN scoring_capabilities TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS compatibility_settings (
	id TEXT PRIMARY KEY CHECK (id = 'global'),
	weights TEXT NOT NULL,
	updated_by_account_name TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
