In progress scouting tool for FTC, and later FRC :3

## FTC API setup

The team lookup runs through the Cloudflare Worker. The FTC credentials and Clerk secret stay server-side and must never be added to `VITE_*` variables.

For local development, create a `.dev.vars` file with:

```text
CLERK_SECRET_KEY=sk_test_your_clerk_secret
FTC_API_USERNAME=your_ftc_api_username
FTC_API_KEY=your_ftc_api_key
FTCSCOUT_API_TOKEN=your_ftcscout_token
```

For the published Worker, set the same values as Wrangler secrets:

```bash
npx wrangler secret put CLERK_SECRET_KEY
npx wrangler secret put FTC_API_USERNAME
npx wrangler secret put FTC_API_KEY
npx wrangler secret put FTCSCOUT_API_TOKEN
```

Then run `npm run build && npx wrangler deploy`. The authenticated lookup endpoint is `/api/teams/:teamNumber`.

Database migrations are intentionally manual. Apply them locally with:

```bash
npm run db:migrate:local
```

Apply them to the published database only when you are ready:

```bash
npm run db:migrate:remote
```

Confirm Wrangler's prompt with `Y`, then deploy the Worker separately.

---

Built with ❤️ using React Router.
