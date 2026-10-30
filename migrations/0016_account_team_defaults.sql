ALTER TABLE user_settings
	ADD COLUMN ftc_team_number INTEGER NOT NULL DEFAULT 7247 CHECK (ftc_team_number IN (7247, 5445));

ALTER TABLE user_settings
	ADD COLUMN team_preset TEXT NOT NULL DEFAULT 'SLB' CHECK (team_preset IN ('SLB', 'FTC'));

UPDATE user_settings
SET ftc_team_number = CASE
		WHEN team_number IN (7247, 5445) THEN team_number
		ELSE 7247
	END,
	team_preset = CASE WHEN team_number = 5837 THEN 'SLB' ELSE 'FTC' END,
	team_number = 5837;
