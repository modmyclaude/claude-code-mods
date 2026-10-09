# Porthole

A live preview of the app you are building, right beside the chat.

## Install

```
/plugin install porthole --marketplace modmyclaude/claude-code-mods
```

## Use it

| You type | What happens |
| --- | --- |
| `/porthole http://localhost:5173` | Opens the Porthole pane with a screenshot of the page, sized to the pane. A site other than localhost opens only when you type the command yourself. |
| `/porthole` | Opens the last dev-server address porthole saw (or the page already in the pane). |
| `/porthole mobile` / `/porthole desktop` | Switches the viewport to 390 px or 1280 px wide and shoots again. |
| `/porthole 3000` or `/porthole localhost:3000/app` | Shorthands for a local address. |

`/porthole` runs at once even while Claude is working, so you can open or refresh the preview mid-turn.
When it works it says so in a toast and adds nothing to the conversation; a refusal (an address it will
not open, Chrome missing) stays visible as the command's output.

- **Dev-server detection.** When a Bash result from Claude names a local server
  (`http://localhost:<port>` or `http://127.0.0.1:<port>`), a toast says
  `Open in porthole: http://localhost:5173/ - type /porthole`. Each address is offered once per session.
  Only foreground Bash results are read: a server Claude starts in the background is offered once its log
  passes through a Bash result (for example `cat` of the log).
- **Auto refresh.** While the pane is open, a file edit by Claude (Edit, Write, MultiEdit, NotebookEdit)
  refreshes the screenshot 2 seconds later. Edits inside that window share one refresh, so refreshes are
  never closer than 2 seconds apart, and the dev server gets a moment to rebuild first. Only local pages
  refresh this way; a remote page you opened refreshes when you press `Refresh`.
- **In the pane.** A status line (address, viewport, shot number), a `Refresh` button and a
  `Mobile` / `Desktop` button. Close it with the pane's own close mark; that also deletes the picture.

## Settings

| Field | Default | Meaning |
| --- | --- | --- |
| `chromePath` | empty | Full path to a Chrome or Chromium executable. Empty: porthole looks in `/Applications` (Google Chrome, Chromium) and then on `PATH` (`google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`). |

## What it can touch

- **Processes.** For each screenshot: `mktemp -d` to make a private run folder in `$TMPDIR`, then the Chrome
  you already have, headless:
  `--headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check --disable-extensions --disable-background-networking --disable-sync --use-mock-keychain --force-device-scale-factor=1 --timeout=15000 --user-data-dir=<run folder>/profile --window-size=W,H --screenshot=<run folder>/shot.png <url>`.
  Arguments are passed as a list, never through a shell. Chrome is stopped as soon as it reports the PNG
  written (30 second hard stop). `rm -rf` runs only on porthole's own run folders
  (`$TMPDIR/porthole.XXXXXX` and the profile inside), checked by an allow-list before every call.
- **Browser profile.** A brand new profile every shot, deleted as soon as Chrome stops: no cookies, no
  signed-in accounts, nothing shared with your own Chrome.
- **Files and environment.** Checks that Chrome and the screenshot exist. Reads no project files. Reads
  the `PATH` and `TMPDIR` variables. The screenshot is read by the terminal itself to draw it.
- **Network.** Porthole itself makes no network calls. Chrome loads the page you asked for and everything
  that page loads in turn (scripts, fonts, images, API calls, which can be on other sites), and runs its
  JavaScript, as any browser would, once per screenshot. Headless Chrome itself may also make background
  requests of its own (component updates, safe browsing and similar), even for a localhost page: the
  flags above switch off the ones Chrome lets you switch off, but this is not verified to be zero.
- **Who may open what.** Porthole opens `localhost` and `127.0.0.1` on its own. Any other site opens only
  when you type `/porthole <full http:// or https:// URL>` yourself, at the terminal or through Remote
  Control. The same command arriving from anywhere else (another plugin, a peer session, a channel relay,
  a task notification, a schedule, an SDK script) gets localhost only and a one-line refusal. `file:`,
  `javascript:`, `data:`, `chrome:` and every other scheme are always refused.
- **Model calls.** None.

## Limits

- **Terminal only.** The picture is a terminal `Image` (kitty graphics protocol). The engine documents
  kitty and Ghostty; in a terminal it cannot draw in (or over ssh or tmux, where the terminal cannot read
  the file) the pane shows a text stand-in, a toast says so once, and auto refresh pauses. Manual refresh
  still works.
- **Desktop app, VS Code, mobile.** The pane shows one line pointing you to the desktop app's built-in
  browser pane, and porthole does not start Chrome there. (Commands typed in the desktop app likely arrive
  as SDK turns, which count as not typed by you; with no terminal there is no screenshot either way.)
- **A screenshot, not a browser.** You cannot click or scroll the page; you see its top. Pages behind a
  login show the logged-out view, by design of the throwaway profile.
- **The toast has no button.** Toasts in this API carry text only, so the toast names the command to type.
- **Detection reads Bash results only.** A server Claude starts in the background is caught when its log
  passes through a Bash result (for example `cat` of the log). Addresses like `0.0.0.0`, `[::]` or a LAN IP
  are not detected; type them in full.
- **Sizing.** The first shot after opening is 1280 x 800 (the pane has not been measured yet); later
  desktop shots match the pane's shape. Pictures are fitted assuming a terminal cell about twice as tall
  as it is wide.
- **macOS and Linux.** Uses `mktemp` and `rm`; Windows is not supported.

## Built from a prompt

This mod was built from [prompts/porthole.md](../../prompts/porthole.md).
