# Test commands

## Health

```bash
curl https://YOUR-GATEWAY/health
```

## Text ping

```bash
curl -X POST https://YOUR-GATEWAY/engine/ping \
  -H "content-type: application/json" \
  -H "x-dentorax-admin-token: YOUR_ADMIN_TOKEN" \
  -d '{"mode":"text_ping"}'
```

## Image triage

Use Dentorax frontend to send image payload, or send JSON:

```json
{
  "mode": "image_triage",
  "image": {
    "mimeType": "image/jpeg",
    "base64": "..."
  }
}
```
