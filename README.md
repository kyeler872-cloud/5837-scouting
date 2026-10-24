In progress scouting tool for FTC and FRC.

FTC data comes from the FIRST Tech Challenge API; FRC team, event, award, and match data comes from The Blue Alliance API v3.

Event records are searchable by program, season, and region. Event pages include shared categorized notes, team rosters (with manual team additions for custom events), and an editable photos link.

The `/settings` page contains shared FTC 2026–27 team-compatibility weights; signed-in users can edit them. Restricted audit logs and whitelist management remain limited to Kyeler Werkmeister and accounts added to the whitelist. Apply new D1 schema migrations before deploying with `npm run db:migrate:remote`.

FTC 2026–27 robot entries can store autonomous paths drawn on the season field image. Apply migration `0011_robot_autos.sql` before deploying the auto mapper.

---

Built with ❤️ using React Router, TheBlueAlliance API, FIRST API, and Cloudflare :)
