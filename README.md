In progress scouting tool for FTC and FRC.

FTC data comes from the FIRST Tech Challenge API; FRC team, event, award, and match data comes from The Blue Alliance API v3.

Event records are searchable by program, season, and region. Event pages include shared categorized notes, team rosters (with manual team additions for custom events), and an editable photos link.

The `/logs` debug page records authenticated database edits for seven days. Access is limited to Kyeler Werkmeister and accounts added to the page whitelist. Apply new D1 schema migrations before deploying with `npm run db:migrate:remote`.

---

Built with ❤️ using React Router, TheBlueAlliance API, FIRST API, and Cloudflare :)
