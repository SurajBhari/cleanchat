# CleanChat — YouTube Live Chat Filter

A browser extension (Manifest V3) that makes fast-moving YouTube live chat **readable and moderatable**. It runs in two modes with different goals:

- **🎮 Streamer mode** — cut the noise so you (and your overlay) only see chat that matters.
- **🛡 Moderator mode** — surface the things that need attention: spam, links, caps, and keyword alerts.

Works on `youtube.com/live_chat`, the watch-page chat, and the YouTube **Studio** live chat. All filtering happens locally in your browser — **no data leaves your machine** (the only permission used is `storage`).

## Features

### Streamer mode
- **Hidden users** — auto-hides common bots (Nightbot, StreamElements, StreamLabs, Moobot) plus anyone you add.
- **Blocked words / phrases** — hide messages containing terms you choose.
- **Hide commands** — drop `!command` chat spam.
- **Hide duplicates** — collapse repeated messages, with an adjustable repeat-gap window.
- **Hide emote-only / short messages** — with a configurable minimum length.
- **Filter by member level** — optionally hide non-members, members, or moderators.
- **Highlights** — first-time chatters ✨, Super Chats 💰, and messages by role (mod/owner/member).
- **Speed limit** — cap how many messages per second are shown so chat stays readable.
- **Keyword highlights** — flag chosen keywords in a color you pick.

### Moderator mode
- **Live search** — filter the chat by message text or username.
- **Detections** — highlight links 🔗, caps spam (with adjustable threshold), and emoji spam 🤡.
- **First-message alerts** — get notified when a new viewer chats for the first time 🎉.
- **Alert keywords** — with optional whole-word matching and an alert sound 🔔.
- **Export chat log** — save the session's messages for review.

### Both modes
- Live stats: total messages, filtered count, messages/min, unique users.
- **Import / export config** (per-mode or both) to move your setup between machines.
- Reset-to-default and clear-all controls.

## Install

**Unpacked (development):**

1. Clone or download this repo.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open a YouTube live chat — the CleanChat icon in the toolbar opens the controls.

Firefox is also supported (the manifest declares a `gecko` ID, min version 140).

## How it works

`content.js` runs inside the live-chat frame, observes new chat messages, and applies your filters/highlights in real time. Settings sync via `chrome.storage.sync`; the "seen users" set (for first-timer detection) is kept in `chrome.storage.local`. `popup.html`/`popup.js` are the control panel. There is no backend.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest, permissions, content-script matches. |
| `content.js` | Core filtering/highlighting engine injected into the chat frame. |
| `content.css` | Styling for highlights, hidden states, badges. |
| `popup.html` / `popup.js` / `popup.css` | The toolbar control panel. |
| `background.js` | Service worker. |
