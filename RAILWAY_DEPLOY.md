# X NOBITA XD — Multi Pair Railway Setup

## Environment variable
- `TELEGRAM_BOT_TOKEN` = Telegram BotFather token
- Optional: `TG_GROUP_LINK` = Telegram pairing group invite link
- Optional: `WA_CHANNEL_LINK` = WhatsApp channel link

## Start
`npm start`

## Telegram pairing
Use in a Telegram group:
`/pair 919876543210`

Each paired number is stored under `sessions/<number>/` and runs as an independent WhatsApp session.

## Persistence
Attach a Railway Volume and mount it at the project working directory (or the directory used by the service). The `sessions/` and `data/` directories must persist across restarts/deploys if you want paired sessions and settings to survive.
