# Twitch Live Checker

A Windows desktop dashboard that shows which of your favorite Twitch streamers are live right now, alerts you when someone goes live, automatically gives them a shoutout in your chat, and lets you know when someone chats in your channel while it's quiet.

Everything runs on your own computer. There is no account to create with this app, no server, and no tracking: it talks only to Twitch, using a Twitch app that **you** register (free, takes a couple of minutes).

## Features

- **Live dashboard:** a card for each streamer with live/offline status, stream title and viewer count. Optionally hide offline streamers.
- **Live alert sound:** a chime when someone goes live. Use the built-in chime or choose your own MP3, WAV or OGG file, with a volume slider.
- **VIP streamers:** star favorites to highlight their cards, and manage the list in the VIP editor.
- **Auto-shoutout:** when a tracked streamer goes live, the app posts a message like `!so streamername` in your chat. A **Resend All Shoutouts** button sends one for everyone currently live. Send as your own account or a separate bot account.
- **Chat alerts:** a sound when someone chats in your channel, with auto-quiet for busy chats. See [Chat Alerts](#chat-alerts).
- **Stream overlay:** a compact, auto-scrolling list of who's live in its own window, made for OBS. See [Stream overlay](#stream-overlay).
- **Themes:** dark or light, with color presets and a custom accent color.
- **Streamer list tools:** add streamers by username or `twitch.tv` link (one per line, checked against Twitch), remove them, and import or export the list as a text file.
- **Auto-refresh:** every 1, 5, 10, 15, 30 or 60 minutes, or press Refresh any time.
- **Tray icon:** closing the window keeps the app running in the system tray.
- **First-run setup wizard** that walks you through everything below.

## Install

1. Download the latest installer, `Twitch Live Checker Setup <version>.exe`, from the [Releases](../../releases) page and run it.
2. Windows may show a SmartScreen warning because the installer isn't code-signed. Choose **More info → Run anyway**.
3. Follow the setup wizard on first launch. You'll need the Twitch app credentials from the next section.

## Set up your Twitch app

The app needs a Twitch "application" of your own so that Twitch knows who is asking for stream information. Your credentials never leave your computer.

1. Go to the [Twitch developer console](https://dev.twitch.tv/console) and sign in. Twitch requires two-factor authentication to be turned on for your account before you can register an app.
2. Click **Register Your Application**.
3. Fill in the form:
   - **Name:** anything unique (Twitch doesn't allow names containing "Twitch").
   - **OAuth Redirect URLs:** `http://localhost:3000`
   - **Category:** Application Integration
   - **Client Type:** Confidential
4. Click **Create**, then **Manage** on your new app.
5. Copy the **Client ID**, and click **New Secret** to generate a **Client Secret**.
6. Paste both into the setup wizard (or later in **Settings → Twitch App Credentials**).

**Is it safe?** The Client Secret is encrypted with your operating system's credential protection and stored in your Windows user profile, never in the project folder and never sent anywhere except to Twitch. The app's small internal web server only accepts connections from your own computer and requires a random key generated each time the app starts.

## Log in with Twitch

Auto-shoutouts and chat alerts need to know which channel is yours. Click **Log in with Twitch** in the wizard or in **Settings → Automatic Shoutouts**. Your browser opens, you approve the permissions, and the app remembers the login (encrypted). Port 3000 must be free for a moment while you log in.

The permissions requested are:

| Permission | Why |
| --- | --- |
| `user:write:chat` | Send the shoutout message in chat |
| `channel:bot` | Allows a separate bot account to send messages in your channel, if you choose that option |

Chat alerts need **no extra permission**: they read your chat the same way a logged-out viewer does.

## Auto-shoutouts

The app sends a chat message when a tracked streamer goes live, once per streamer per live session. It checks every minute.

- **Message:** set it in **Settings → Automatic Shoutouts**. The default is `!so {username}`, where `{username}` is replaced by the streamer's name.
- **The app only sends the message.** Your chat bot (StreamElements, Nightbot, etc.) is what turns `!so` into a shoutout, so the message must match a command you've set up there:
  - **StreamElements:** Custom Commands → Add New Command, name it `so`, response for example `Go check out ${touser} at https://twitch.tv/${touser}`
  - **Nightbot:** `!commands add !so Go check out $(touser) at https://twitch.tv/$(touser)`
- **Who sends it:** by default, your own account. To use a separate bot account, choose **A separate bot account** in Settings and click **Log in Bot Account**. Do this in a browser that is signed in to the bot account (a private window works well). Chat bots generally ignore their own messages, so the sending account should not be the same account your StreamElements or Nightbot bot runs on. If your command is restricted to moderators, make the sending account a moderator or lower the command's access level.
- **Turn it off** with the Automatic Shoutouts checkbox, or resend manually with **Resend All Shoutouts**.

## Chat Alerts

Plays a sound when someone chats in your channel, so you don't miss a message when chat is quiet. Let it stay quiet automatically, or switch it off, when chat is busy.

### Turning it on
- Click **Chat Alerts** in the header, press the keyboard shortcut (default **Ctrl+Alt+C**, works even while the window is hidden in the tray), or use the tray menu.
- You need to be logged in with **Log in with Twitch** so the app knows which channel is yours.
- While it's on, the header shows when chat was last active, and briefly shows who just wrote.

### Settings (Settings → Chat Alerts)

| Setting | What it does |
| --- | --- |
| Quiet minutes | Only alert after chat has been silent this long, so a busy chat doesn't spam you but the first message after a lull always gets through. `0` alerts on every message. Default: 3. |
| Alert limit | At most one alert every this many seconds. `0` = no limit. Default: 5. |
| Keyboard shortcut | Click the field, then press the keys (needs Ctrl, Alt or the Windows key). Escape leaves it unchanged. |
| Ignore list | Accounts that never trigger an alert, such as your chat bots, one per line. Empty by default. Your own messages are always ignored. |
| Chat alert sound | Built-in chime, or choose your own MP3, WAV or OGG (up to 2 MB), with volume and a test button. Separate from the live alert sound. |

### Privacy and how it works
- It reads your channel's chat **anonymously and read-only**, like a logged-out viewer. It uses no extra Twitch permissions and cannot send messages.
- It only connects while Chat Alerts is **on**. Chat messages are never saved or logged; only the sender's name is used, briefly, to show "New chat from ...".
- If the connection drops it reconnects by itself.

## Stream overlay

A compact list of who's live that scrolls in its own window, sized for a narrow slot in your scene.

1. Open it from **Settings → Stream Overlay → Open Overlay Window** (or the tray menu).
2. In OBS, add a **Window Capture** source and choose **Live Checker Overlay**.
3. Adjust scroll speed, stream title display, viewer counts, and whether the window stays on top. Choose **Solid green** as the background if you'd rather use a Chroma Key filter in OBS.

The overlay can also open automatically when the app starts.

## Your data

Settings and secrets are stored in your Windows user profile (in the app-data folder, in a `config` folder), never in the program folder:

- `settings.json`: ordinary preferences, your streamer and VIP lists, your Client ID
- `secrets.json`: your Client Secret and login tokens, encrypted with Windows credential protection

Uninstalling the app does not delete these. Delete the `config` folder if you want everything gone. Custom sound files you choose are copied there too, so the originals can be moved or deleted freely.

## Troubleshooting

- **"A login attempt is already in progress" or the login page doesn't load:** something else is using port 3000, or a previous login window is still open. Close it and try again.
- **"Secure storage is not available":** Windows credential protection wasn't available, so the secret wasn't saved. Make sure you're signed in to a normal Windows user account.
- **Shoutouts aren't appearing:** check you're logged in (Settings → Automatic Shoutouts), the message matches your bot's command, and the sending account is allowed to use it.
- **Chat alerts: "Log in with Twitch in Settings to start":** log in first; it starts on its own afterwards.
- **Chat alerts: shortcut doesn't work:** another program may be using it. The header says so; pick a different combination in Settings.
- **No sound:** use **Play Test** in Settings, and check the volume slider and your computer's sound output.

## For developers

Requires [Node.js](https://nodejs.org) (current LTS).

```
npm install
npm start        # run the app
npm test         # run the test suite (node --test)
npm run build    # build the Windows installer into dist/
```

```
main.js            Electron main process: windows, tray, timers, wiring
preload.js         the small, explicit bridge between the app and its pages
src/               settings and encrypted storage, Twitch API client, login flow,
                   shoutout engine, local server, sounds, overlay window,
                   chat listener, chat alert rules and service
public/            dashboard, setup wizard and overlay pages (plain HTML, CSS, JS),
                   plus sounds and icons
test/              automated tests
```

The code is written so the Twitch connection, storage and timers can be replaced by fakes in tests, so the whole suite runs without Electron, a network or real credentials.

## License

MIT
