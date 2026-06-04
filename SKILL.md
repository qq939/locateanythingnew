# SKILL.md - LocateAnything New

This project is a simple local video annotation web app on port 8082.

## Run

```bash
./user_start.sh
```

The script frees port 8082 and starts `node server.js`, preferably in a detached `screen` session.

## Verify

```bash
node --check server.js
curl -s http://127.0.0.1:8082/health
```

Browser smoke test:

1. Upload a video.
2. Confirm the first frame renders.
3. Draw a box.
4. Click Locate current frame.
5. Save JSON and confirm `data/annotations.json` exists.

## Notes

`/api/locate` is currently a demo response endpoint. Keep the UI simple; add real model integration only when the runtime is ready.
