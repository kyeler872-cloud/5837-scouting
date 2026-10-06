In progress scouting tool for FTC and FRC.

FTC data comes from the FIRST Tech Challenge API; FRC team, event, award, and match data comes from The Blue Alliance API v3.

---

Built with ❤️ using React Router.

## Clerk configuration

The deployed Worker needs a `CLERK_SECRET_KEY` secret and a matching
`CLERK_PUBLISHABLE_KEY` variable from the same Clerk instance and environment.
Add the secret with `npx wrangler secret put CLERK_SECRET_KEY`. Configure the
publishable key as a Worker variable in the Cloudflare dashboard.

For local development, place the matching keys in the ignored `.dev.vars` file:

```dotenv
CLERK_PUBLISHABLE_KEY=pk_test_replace_with_your_key
CLERK_SECRET_KEY=sk_test_replace_with_your_key
```

Do not commit `.dev.vars` or expose the secret key. Restart the development
server after changing local variables.

## The Blue Alliance configuration

FRC lookups use The Blue Alliance API v3. Add your read API key as a Worker
secret named `TBA_AUTH_KEY`:

```sh
npx wrangler secret put TBA_AUTH_KEY
```

For local development, add `TBA_AUTH_KEY=your_read_api_key` to the ignored
`.dev.vars` file. Keep this key server-side; the app sends it to The Blue
Alliance in the `X-TBA-Auth-Key` header and never exposes it to the browser.

FRC lookups use the team, season-events, season-awards, and season-matches
endpoints. The Auto and TeleOp averages are calculated from each played match's
alliance score breakdown. The Blue Alliance asks applications to identify
their data source, so FRC team pages include a powered-by attribution link.
See [The Blue Alliance API documentation](https://www.thebluealliance.com/apidocs)
and [API v3 specification](https://www.thebluealliance.com/swagger/api_v3.json).
