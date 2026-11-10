ALTER TABLE user_settings
	ADD COLUMN search_league TEXT NOT NULL DEFAULT 'FTC' CHECK (search_league IN ('FTC', 'FRC'));

ALTER TABLE user_settings
	ADD COLUMN search_type TEXT NOT NULL DEFAULT 'team' CHECK (search_type IN ('team', 'event'));
  