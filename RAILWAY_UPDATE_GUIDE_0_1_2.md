# Railway Update Guide — Gateway v0.1.2

## 1. Upload to GitHub

In the existing `dentorax-secure-vision-gateway` repository root, upload/overwrite the files from this package.

Do not upload the folder itself.

Expected root layout:

```text
server.js
package.json
package-lock.json
railway.json
Dockerfile
README.md
PROMPT_PROTOCOL_8_8_3H_V0_2.md
CHANGELOG_0_1_2.md
```

## 2. Commit

Suggested commit message:

```text
Upgrade Gateway to v0.1.2 Prompt Protocol 8.8.3H
```

## 3. Railway deployment

Railway should auto-deploy after commit.

If not, manually redeploy the service.

## 4. Health check

Open:

```text
https://dentorax-secure-vision-gateway-production.up.railway.app/health
```

Expected:

```json
"gatewayVersion": "0.1.2"
```

And inside config:

```json
"promptProtocol": "8.8.3H-v0.2"
```

## 5. Studio test

Run Dentorax Studio Hotfix 3 and analyze the same OPG.

Expected response:

```json
"engineStatus": "engine_active",
"source": "secure_gateway",
"model": "DX-Vision Primary",
"patientRecapEN": [],
"patientRecapFA": [],
"visualBoardPlan": {}
```

Each finding should remain:

```json
"visibleToPatient": false
```
