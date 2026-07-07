# Railway crash fix — clean package-lock

If Railway crashes/fails immediately after uploading v0.1.1, check whether `package-lock.json`
contains private/internal package registry URLs.

This clean-lock package fixes that by:

- Replacing internal package registry URLs with `https://registry.npmjs.org/`
- Adding `.npmrc` with `registry=https://registry.npmjs.org/`

Upload/overwrite these files in the GitHub repository root:

- `server.js`
- `package.json`
- `package-lock.json`
- `.npmrc`
- `railway.json`
- other docs as needed

Then commit to `main` and wait for Railway redeploy.

Expected health check after deploy:

```json
{
  "ok": true,
  "gatewayVersion": "0.1.1"
}
```
