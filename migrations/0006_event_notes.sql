CREATE TABLE IF NOT EXISTS event_notes (
	league TEXT NOT NULL,
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	category TEXT NOT NULL,
	note TEXT NOT NULL DEFAULT '',
	updated_by TEXT NOT NULL,
	updated_by_account_name TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (league, season, event_code, category)
);

CREATE TABLE IF NOT EXISTS event_assets (
	league TEXT NOT NULL,
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	photos_url TEXT NOT NULL DEFAULT '',
	updated_by TEXT NOT NULL,
	updated_by_account_name TEXT NOT NULL,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (league, season, event_code)
);

CREATE TABLE IF NOT EXISTS event_manual_teams (
	league TEXT NOT NULL,
	season TEXT NOT NULL,
	event_code TEXT NOT NULL,
	team_number TEXT NOT NULL,
	team_name TEXT NOT NULL DEFAULT '',
	added_by TEXT NOT NULL,
	added_by_account_name TEXT NOT NULL,
	added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (league, season, event_code, team_number)
);
