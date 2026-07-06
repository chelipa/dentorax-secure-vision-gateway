# Dentorax Secure Vision Gateway v0.1

A foreign-hosted, provider-hidden, compliance-aware backend gateway for Dentorax OPG analysis.

## Purpose

```text
Clinic browser
→ Dentorax frontend
→ Secure foreign-hosted backend
→ Vision Engine provider
→ normalized JSON
→ Dentist review
→ Patient-safe recap
```

The clinic must not need VPN/filter-breakers. API keys must never be exposed in the browser. Provider names must not appear in clinic/patient UI.

## Routes

### GET `/health`
Safe public gateway status.

### GET `/engine/status`
Admin status panel. If `DENTORAX_ADMIN_TOKEN` is set, send it as `x-dentorax-admin-token`.

### POST `/engine/ping`
Engine Lab route.

Text ping:

```json
{ "mode": "text_ping" }
```

Image triage:

```json
{
  "mode": "image_triage",
  "image": { "base64": "...", "mimeType": "image/jpeg" },
  "cropMeta": {}
}
```

Full JSON:

```json
{
  "mode": "full_opg_json",
  "image": { "base64": "...", "mimeType": "image/jpeg" },
  "cropMeta": {}
}
```

### POST `/analyze-opg`
Full Dentorax OPG analysis route.

```json
{
  "image": { "base64": "...", "mimeType": "image/jpeg" },
  "paImages": [],
  "cropMeta": {}
}
```

## First external test order

1. Deploy to Railway or Render.
2. Open `/health`.
3. Run `/engine/ping` with `text_ping`.
4. Run `/engine/ping` with `image_triage`.
5. Run `/engine/ping` with `full_opg_json`.
6. Point Dentorax frontend to this gateway.

## Recommended first test

```env
GEMINI_MODEL=gemini-3.5-flash
GEMINI_API_MODE=interactions
```

If image route fails, try:

```env
GEMINI_API_MODE=generate_content
```

## Safety posture

- No raw image logging.
- No browser-side provider API key.
- No provider/model shown to clinic/patient UI.
- No mock replacement on engine failure.
- Patient recap must remain locked until real engine output and dentist approval.
