# Railway dependency guard — v0.1.1b

This patch fixes Railway crashes where the runtime starts with missing dependencies, for example:

```text
Error: Cannot find package '/app/node_modules/express/index.js' imported from /app/server.js
ERR_MODULE_NOT_FOUND
```

The package now includes a `prestart` script:

```json
"prestart": "npm install --omit=dev --no-audit --no-fund"
```

Railway runs npm lifecycle scripts before `npm start`, so dependencies are installed even if the build layer/cache skipped them.

Expected health check after deployment:

```json
{
  "ok": true,
  "gatewayVersion": "0.1.1"
}
```

Note: The public gateway version can remain `0.1.1`; `0.1.1b` is a deployment packaging patch.
