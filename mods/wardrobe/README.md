<img src="../../brand/pixel-icons/svg/wardrobe.svg" width="64" height="64" alt="">

# Wardrobe

Restyle Claude Code live, including colourblind-safe and high-contrast themes.

## Install

```
/plugin install wardrobe --marketplace modmyclaude/claude-code-mods
```

## Use it

| Command | What it does |
| --- | --- |
| `/wear` | Opens the gallery: a card per theme with a sample tool row drawn in that theme, its diff chips, Bolt in the theme's costume and a `wear` button; in the desktop app each card also shows the look's scene, small and still. The one you wear is marked. Close it with its close mark or ctrl+x x. |
| `/wear <theme>` | Switches now. Rows still live on screen redraw in the new look, the switch band shows the theme above the prompt for six seconds, the desktop app takes the look's colours and scene, and Claude Code's own theme follows the look (see Matching Claude Code's theme). |
| `/wear <theme> everywhere` | Wears it in every project: the global choice changes and every project pin is let go, so nothing keeps another look. Sessions already open follow within a minute. `/wear everywhere` alone does the same with what this project wears now, and `--match` may ride with either. |
| `/wear auto` | A day theme by day and a night theme by night (see Settings). |
| `/wear season` | The seasonal pack the calendar calls for, re-checked daily (see Seasonal packs). |
| `/wear pin` | This project keeps what it wears now; other projects keep the global choice. While pinned, `/wear <theme>` changes this project's pin. |
| `/wear unpin` | This project follows the global choice again. |
| `/wear wallpaper off` | Keeps the look and drops its scene behind the chat in the desktop app; `/wear wallpaper on` brings scenes back, and `/wear wallpaper` says which way it is set (see Wallpapers). |
| `/wear <theme> --match` | Wears the theme and matches Claude Code's own theme to it, answering in full whatever happened. With the Match setting off, this, `/wear match` and the gallery's `match theme` button are the only ways a match is made. |
| `/wear match` | The same for the theme worn now. With the Match setting off, each gallery card has a `match theme` button that wears and matches at once. |
| `/wear default` | Back to Claude Code's own drawing. After a match, Claude Code's theme goes back to the one you had, unless you changed it yourself since the match: then your choice stands. In a pinned project it takes the look off that project alone, and gives the theme back only if the match was made there. |

Each command answers in a toast (an unknown theme's message stays longer). Nothing `/wear` says is added to the conversation, so it costs no tokens and never reaches the model.

Themes: `noir`, `paper` (light), `tokyo-night`, `dracula`, `catppuccin`, `solarized`, `nord`, `high-contrast`, `colorblind`, and the seasonal packs `halloween`, `christmas`, `spring` (light), `summer`, `autumn`. Short forms work too: `drac`, `hc`, `colourblind`, `tokyo night`, `xmas`, `fall`, `spooky`, and any prefix that names one theme alone (`sp` is spring, `su` is summer).

### Matching Claude Code's theme

Putting a look on also sets Claude Code's own `theme` setting (the `/theme` menu) to match it, so the parts wardrobe cannot draw follow the look: in the terminal the input box border, your message background, the text and the diff colours. Every look ships as a Claude Code theme file (`themes/<look>.json`), listed in `/theme` as "<Look> (wardrobe)", and the match takes that file; where Claude Code does not list it, the nearest built-in stands in (a light look on a dark theme turns the theme light, keeping a daltonized or ansi variant).

- The first change is said in the same toast, with how to undo it. Later looks move the match without saying so again.
- Your own theme is remembered, and `/wear default` puts it back.
- A theme you pick yourself after a match is yours: wardrobe leaves it alone until the next look you put on, and `/wear default` then returns to that one.
- `/wear auto`, `/wear season` and a look put on in another session carry a match already made, and never start one. Where auto wears Claude Code's own look by day, your own theme comes back for the day and the match returns with the night.
- Claude Code has one theme setting for every session on the machine, so the match follows the look every project shares. A pinned project's look is its own: `/wear <theme>` there leaves the theme alone, and so does a pinned look that changes by itself. `/wear <theme> --match` in a pinned project still matches, on your word; that match then belongs to the project: the shared look never carries it off, `/wear default` there gives your theme back, and `/wear unpin` or `/wear everywhere` hands it to the shared look.
- A locked setting, or another plugin that refuses the change, is left alone and never retried. A setting that cannot be read is never written over.
- The Match setting turns all of this off; then only `--match`, `/wear match` and the gallery's `match theme` button set the theme.

What changes, on the terminal and in the desktop app:

| Where | What wardrobe draws |
| --- | --- |
| Tool rows | A one-cell stripe in the theme's accent, the theme's icon for the kind of tool (shell, read, edit, write, search, web, agent, todo, MCP), Claude Code's own row, then a status glyph and, for a finished call, the time since Claude asked for it (any wait for your approval included). |
| Folded tool groups | The stripe, one icon per call before the count line; a failed call in the error colour. |
| Diff cards (Edit, Write) | Numbered lines in the theme's add and remove colours, with a `+N -N` summary. |
| Small shell output | A themed card; stderr lines are marked `!`, not only coloured. |
| Spinner | The theme's suffix after the word (never over Claude Code's own status message); on a terminal 60 columns or wider, a chip saying what the turn is doing (thinking, writing, using tools). |
| Turn duration | A themed `Baked for 3s` line (the terminal draws this line; the desktop has its own footer). |
| Above the prompt | The switch band, for six seconds after `/wear` (see below). |

### Seasonal packs

Five themes made for a time of year, each with its own mark and icons: `halloween` (pumpkin orange, violet and bone white on near-black, mark `☾`), `christmas` (holly green, berry red, snow white and gold on deep pine, `❄`), `spring` (a light theme: fresh green, blossom pink and sky blue on cream, `❀`), `summer` (sun yellow, sea teal and coral on deep navy, `☼`) and `autumn` (amber, rust, moss and cream on dark brown, `❧`). Every pair they paint meets the same 4.5:1 bar as the other themes.

`/wear season` picks one by the local date and is stored like `auto`: wardrobe re-checks the calendar once a minute, so the pack turns over at midnight on its own, and `/wear` names what it wears now and why.

| Dates | Wears |
| --- | --- |
| Oct 15 to Nov 1 | `halloween` |
| Dec 1 to Jan 6 | `christmas` |
| Jan 7 to the end of Feb | `nord` (the frost theme; the rest of winter has no pack of its own) |
| Mar 1 to May 31 | `spring` |
| Jun 1 to Aug 31 | `summer` |
| Sep 1 to Nov 30, Halloween aside | `autumn` |

### Bolt in costume

Bolt, the modmyclaude mascot, wears each theme: in the gallery beside every card, beside the line that names what is worn, and in the switch band. A costume is an accessory drawn over the sprite, never a change to it: a witch hat for `halloween`, a santa hat for `christmas`, a flower crown for `spring`, sunglasses for `summer`, a beanie for `autumn`, a cape and fangs for `dracula`, cat ears for `catppuccin`, a headband for `tokyo-night`, a fedora for `noir`, reading glasses for `paper`, a sun visor for `solarized`, a beanie with a pom for `nord`, a bow tie for `high-contrast`; `colorblind` leaves Bolt plain. Every costume takes at most three colours, all from the theme's own palette, keeps the antenna light clear (each hat has a notch around it), and never uses Bolt's own pink or blush. `tests/costume.test.ts` holds every one of those rules for every theme and pose.

### The app wears the look (desktop app)

In the desktop app a look reaches past the rows wardrobe draws: the app itself takes the look's palette. The page, cards, panels and menus, the text, the borders and the accent, danger, success and warning colours are all made from the look's own colours, in the look's light or dark mode, and five looks pair with the code highlighting theme of the same name (`dracula`, `nord`, `tokyo-night`, `solarized`, `catppuccin`). The main text stands at least 7:1 on every surface of every look, and the quiet text 4.5:1. `/wear default` hands the app back its own colours.

### Wallpapers (desktop app)

Every look has a scene, drawn behind the chat in the desktop app, with Bolt in the look's costume standing at the right:

| Look | Scene |
| --- | --- |
| `noir` | A rooftop in the rain under a red neon sign, searchlights sweeping, a water tower against the city. |
| `paper` | A ruled page: watercolour washes, punch holes, a coffee ring, pencil doodles, a paper plane and a pen line drawing itself. |
| `tokyo-night` | A night skyline under the moon: a lattice tower with beacons, neon signs, a train crossing a viaduct, birds on the wires, light drizzle. |
| `dracula` | A castle on a crag against a huge full moon, pines and a graveyard below, bats crossing, violet mist. |
| `catppuccin` | A windowsill at dusk: a crescent moon over a village, a cat, a plant, books and fairy lights, bubbles rising. |
| `solarized` | An orrery: six planets circling a sun, an asteroid belt and a comet. |
| `nord` | The aurora over snow-capped ridges, a lake, a cabin with smoke rising, pines and falling snow. |
| `high-contrast` | Outlined shapes on a floor running to a yellow horizon, under an outlined sun. Calm on purpose. |
| `colorblind` | Hills told apart by hatching and dots, a ringed sun, and four kites, each its own shape. |
| `halloween` | A haunted house under a crescent moon, glowing pumpkins, ghosts, an owl, a spider on its web, bats and embers. |
| `christmas` | A village under snow-capped mountains, a decorated tree with gifts, a snowman, string lights, and a sleigh crossing the moon. |
| `spring` | A cherry branch in blossom over a meadow, a stream, tulips and daisies, butterflies and drifting petals. |
| `summer` | Sunset over the sea: a sailboat, an island, gulls, palms, lanterns on a string and a surfboard in the sand. |
| `autumn` | A low sun over forested ridges, geese in a V, hay bales, a scarecrow and tumbling leaves. |

Most scenes are drawn in three layers of depth (far, middle, near) that sway gently against each other; `paper`, `solarized` and `high-contrast` are flat on purpose. The scene comes on with the look and switches with it, `/wear auto` and `/wear season` included; `/wear default` takes it down with the look.

Scenes are pure vector, animated slowly and never flashing, and under the system's reduced-motion setting they stand still, whole. The chat sits on frosted glass tinted with the look's background; the two accessibility looks use a heavier glass so text keeps its contrast.

`/wear wallpaper off` keeps the look and drops the scene; `/wear wallpaper on` brings it back; `/wear wallpaper` says which way it is set. Wallpapers need the desktop app on Claude Code 2.1.325 or newer: the terminal never draws them, and nothing else of wardrobe changes there.

### The switch band

For six seconds after `/wear <theme>` (and after `/wear auto` or `/wear season` resolves to a theme) a band above the prompt shows the switch: one row filled with the theme's background, carrying its mark, `wearing <theme>`, its five icons, and Bolt in the theme's costume at the right when the band is 60 columns or wider. It draws under any other mod's band, never while a survey holds the band, and goes away by itself. `/wear default` raises none.

### Accessibility

- `high-contrast`: every colour pair wardrobe paints is at least 7:1 (WCAG AAA).
- `colorblind`: added lines are blue and removed lines orange, never red and green; tool icons differ by shape (triangle, disc, diamond, square, cross, bars).
- Every other theme, the seasonal packs included: at least 4.5:1 (WCAG AA). `tests/themes.test.ts` checks every pair of every theme.
- Every theme gives each tool kind and each status its own glyph, so colour is never the only cue.
- Every coloured span is painted on the theme's own background, so the contrast holds whatever your terminal's background is.

## Settings

Every setting has a default, so the notice at install about options not yet set is expected. Set these in `/config`. A time wardrobe cannot read falls back to its default, and `/wear` names it.

| Setting | Default | Meaning |
| --- | --- | --- |
| `dayTheme` | `paper` | What `/wear auto` wears by day. |
| `nightTheme` | `tokyo-night` | What `/wear auto` wears by night. |
| `dayStarts` | `07:00` | When the day starts, 24-hour local time. |
| `nightStarts` | `19:00` | When the night starts. A day that crosses midnight (`20:00` to `06:00`) works. |
| `matchTheme` | on | Putting a look on also sets Claude Code's own theme to match it (see Matching Claude Code's theme). Off, only `--match`, `/wear match` and the gallery's `match theme` button do. |

## What it can touch

- Its own store: the global choice, the per-project pins (keyed by the path of the folder the session started in), and, once a theme is matched, the Claude Code theme you had before, the one it set, and the pinned project the match was made in if it was made in one, so `/wear default` can put yours back and can tell when you changed it since.
- For the session, in memory: each tool call's start and end time, for its row.
- The session's theme, in the desktop app: the worn look's palette and scene, set when the look changes and taken down by `/wear default` (`/wear wallpaper off` drops the scene and keeps the palette). Claude Code keeps one theme per session, so setting it replaces a theme another plugin set. `/wear default` clears the session's theme only where wardrobe set one, never at session start, and not where another plugin's scene was seen in its place.
- Reads the project root, the attached surfaces, the clock, and Claude Code's own theme setting (the `/config` theme row) at session start, when the look changes, before a match and before a restore; it also notices when you change that setting.
- Writes Claude Code's theme setting when you put a look on in a project with no pin (`/wear <look>`, a gallery `wear` button), when the look every project shares changes by itself and its match is already standing, and on `/wear default`, which sets it back to the one you had. With the Match setting off it writes it only on `/wear <look> --match`, `/wear match` and the `match theme` button. No files, no processes, no network, no model calls. It never refuses or changes a tool call: its tool hook only notes when a call starts and ends.
- `hooks/make-colors.js` is Claude Code's own palette helper, copied in unchanged as its guide to looks asks; it turns a look's few colours into the hundred the app names. It reads and writes nothing.

### What a look changes, and what it cannot

**It changes:** tool rows and folded groups, diff cards and small shell output, the spinner's word and suffix, the turn line, the switch band, your prompt rows, Claude's reply rows and command output rows (a stripe, and the look's background where it may paint), the `wearing <look>` label in the prompt footer, the `/wear` gallery, Claude Code's own theme (in the terminal the input box border, your message background, the text and the diff colours then follow the look), and in the desktop app the app's own colours and the scene behind the chat.

**It cannot change:** the desktop app's layout, window frame and fonts; Claude Code's own text colours inside the terminal's rows, which follow `/theme` (so the match matters there); the spinner's word, which keeps Claude Code's own colour; permission dialogs, errors, diffs over the size limits and long shell output, which Claude Code draws itself; the terminal emulator's background and font; VS Code and the mobile app; rows already printed on the terminal's main screen; and a light look's row panels on a dark terminal theme or in the desktop app, which stay stripe-only (in the app the palette carries the background).

## Limits

- It restyles what Claude Code lets a mod draw. Claude Code's own text keeps its colours: the tool's own row inside wardrobe's stripe, icon and status, Read and Grep results, the prompt, dialogs and the transcript all follow Claude Code's own `/theme`. Wardrobe styles around them (the stripe, the chips, the band, the gallery); pick a matching `/theme` for the same reading everywhere.
- Tool rows wrap Claude Code's own row instead of replacing it, so expanding a row and its output keep working.
- Claude Code draws these itself: errors, diffs over 120 lines or 8,000 characters, binary diffs, edits held for review, and shell output over 8 lines or holding a control character other than a colour code (a progress bar's carriage return, a bell, NUL).
- Untrusted text it draws (paths, diff lines, shell output, settings) is cleaned first: colour codes are dropped and any other control character shows as U+FFFD, since Claude Code refuses a drawing that holds one.
- Where another mod draws its own tool result or turn line, wardrobe steps aside and that drawing stands. Tool rows, tool groups and the spinner wrap whatever is beneath them.
- A pin belongs to the folder the session started in: a subfolder or a worktree of the same repo is pinned separately.
- On the terminal's main screen, rows already printed keep their look; new rows, and everything in the fullscreen view, follow `/wear`.
- VS Code and the mobile app are not restyled; `/wear` says so when one is attached.
- Where nothing draws a toast or a pane (a `claude -p` run), `/wear` writes its words and the list to the log instead.
- Auto mode and season mode check the clock once a minute, so a switch can land up to a minute late. A choice made in another session reaches this one the same way.
- The switch band is a plain row above the prompt: it never covers a safety hold or a survey, and Bolt is left out of it under 60 columns.
- Tool calls made before wardrobe loaded show no time, and a refused or failed call shows its status but no time.
- The app's palette and the wallpapers need the desktop app on Claude Code 2.1.325 or newer; the terminal, VS Code and the mobile app never draw them, and `/wear wallpaper` says so where nothing does. On an older Claude Code the hook that draws the scene never runs, and the rest of wardrobe is unchanged.
- Claude Code keeps one theme per session, and the latest plugin to set it wins: when another plugin's scene appears over wardrobe's, a toast says so once, and `/wear <theme>` puts wardrobe's back, palette and scene.
- The desktop app ignores a whole palette it finds one unreadable pair of text in, and says nothing when it does. `tests/app-colors.test.ts` holds every look's palette to the helper's own check, so none should be refused; if the app keeps its own colours under a look, that is the first place to look.
- Claude Code has one `theme` setting for every session on the machine. A pinned project wearing a different look keeps its rows and scene and shares that one setting, so its terminal theme may not match its look unless you match it there with `--match`, which then sets the theme for every session.
- Claude Code keeps one theme per session and does not say whose it is. Where another plugin set a theme with no scene after wardrobe's, `/wear default` cannot see it and clears it with its own.
- The gallery's scene pictures show in the desktop app only; the terminal's gallery is unchanged.
- Under the system's reduced-motion setting the desktop app takes the animation out, and every scene rests whole: nothing in a scene is only visible mid-animation.
- Not verified: the paint itself in a real terminal and in the desktop app, the palettes and wallpapers included, and how smoothly the fuller scenes animate on a slow machine. The tests check the drawn trees against each surface's rules, every scene against the backdrop's rules and every palette against the helper's check, not pixels.

## Built from a prompt

This mod was built from [prompts/wardrobe.md](../../prompts/wardrobe.md).

More mods: [the full catalogue](../../README.md#the-mods).
