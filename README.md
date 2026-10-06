In progress scouting tool for FTC, and later FRC :3

Latest news: FTC API works, and the database is set up! Working on user-friendly things now :D

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
