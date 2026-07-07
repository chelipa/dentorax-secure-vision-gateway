# Railway Update Guide — Dentorax Secure Vision Gateway v0.1.1

## Goal

Replace the current Railway Secure Gateway v0.1.0 code with v0.1.1 while keeping the same environment variables.

## Keep these Railway variables unchanged

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash
GEMINI_API_MODE=interactions
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta
DENTORAX_ADMIN_TOKEN=...
ALLOWED_ORIGINS=*
REQUEST_TIMEOUT_MS=90000
```

## Update steps

1. Download/unzip this v0.1.1 package.
2. Replace the files in the existing Secure Gateway GitHub repo.
3. Commit and push to GitHub.
4. Railway should redeploy automatically.
5. Open `/health` and confirm:

```json
"gatewayVersion": "0.1.1"
```

## Then test from Dentorax Studio Hotfix 3

Run Dentorax Studio normally and analyze the same OPG that caused:

```text
Expected ',' or ']' after array element in JSON
```

A successful result should show:

```json
"engineStatus": "engine_active",
"source": "secure_gateway",
"model": "DX-Vision Primary",
"patientRecapEN": [],
"patientRecapFA": []
```

And under `gatewayMeta`:

```json
"jsonRepair": {
  "retryUsed": true
}
```

or:

```json
"jsonRepair": {
  "retryUsed": false
}
```

Both are acceptable if `engineStatus` is `engine_active`.
