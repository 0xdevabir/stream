# LMS integration example

Minimal Node script that creates a live input, prints OBS credentials, mints a
playback token, and writes a self-contained HTML player page.

```bash
# After pnpm db:seed — API key is in .seed-output.json → provider.apiKey
export STREAM_API_KEY="$(node -e "console.log(require('../../.seed-output.json').provider.apiKey)")"
export STREAM_BASE_URL=http://localhost:8080

node create-and-embed.mjs
open player.html
```

Requires the stack to be running (`pnpm run up`).
