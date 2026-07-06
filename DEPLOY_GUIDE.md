# Deploy Guide — Railway / Render

## Railway

1. Create a new GitHub private repo.
2. Upload this project.
3. In Railway, create a new project from GitHub.
4. Select this repo.
5. Add Variables:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL=gemini-3.5-flash`
   - `GEMINI_API_MODE=interactions`
   - `GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta`
   - `ALLOWED_ORIGINS=*` for the first test only
   - `DENTORAX_ADMIN_TOKEN=some-long-random-token`
6. Deploy.
7. Test:
   - `GET https://your-service.up.railway.app/health`
   - `POST https://your-service.up.railway.app/engine/ping`

## Render

1. Create a new Web Service.
2. Connect GitHub repo.
3. Build command:
   - `npm install`
4. Start command:
   - `npm start`
5. Add the same environment variables.
6. Deploy and test `/health`.

## Important

For the first test, `ALLOWED_ORIGINS=*` is okay.
For clinic demo, restrict it:

```env
ALLOWED_ORIGINS=https://app.dentorax.com,https://your-frontend.vercel.app
```

Never expose `GEMINI_API_KEY` in frontend code.
