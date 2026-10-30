CREATE TABLE IF NOT EXISTS user_settings (
	user_id TEXT PRIMARY KEY,
	team_number INTEGER NOT NULL DEFAULT 5837 CHECK (team_number IN (7247, 5445, 5837)),
	theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light')),
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);