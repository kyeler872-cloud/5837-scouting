ALTER TABLE user_settings
	ADD COLUMN primary_league TEXT NOT NULL DEFAULT 'FTC' CHECK (primary_league IN ('FTC', 'FRC'));

ALTER TABLE user_settings
	ADD COLUMN primary_team_number TEXT NOT NULL DEFAULT '7247' CHECK (length(primary_team_number) BETWEEN 1 AND 6);

UPDATE user_settings
SET primary_league = 'FTC',
	primary_team_number = CAST(ftc_team_number AS TEXT);
