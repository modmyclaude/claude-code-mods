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
| `/wear` | Opens the gallery, one family of looks at a time: everyday, tech, sports, seasons and accessible, a button each, opening on the family of the look you wear. Every look of the family is a card with a sample tool row drawn in that theme, its diff chips, Bolt in the theme's costume and a `wear` button; in the desktop app each card also shows the look's scene, small and still. The one you wear is marked. Close it with its close mark or ctrl+x x. |
| `/wardrobe` | The same as `/wear`, with the same words after it: the mod's name is what most people type first. |
| `/wear <theme>` | Switches now. Rows still live on screen redraw in the new look, the switch band shows the theme above the prompt for six seconds, the desktop app takes the look's colours and scene, and Claude Code's own theme follows the look (see Matching Claude Code's theme). |
| `/wear <theme> everywhere` | Wears it in every project: the global choice changes and every project pin is let go, so nothing keeps another look. Sessions already open follow within a minute. `/wear everywhere` alone does the same with what this project wears now, and `--match` may ride with either. |
| `/wear auto` | A day theme by day and a night theme by night (see Settings); on a game day, your game look (see Sports looks). |
| `/wear season` | The seasonal pack the calendar calls for, re-checked daily (see Seasonal packs); the two holiday looks on their days where you ask for them, and your game look on a game day. |
| `/wear pin` | This project keeps what it wears now; other projects keep the global choice. While pinned, `/wear <theme>` changes this project's pin. |
| `/wear unpin` | This project follows the global choice again. |
| `/wear wallpaper off` | Keeps the look and drops its scene behind the chat in the desktop app; `/wear wallpaper on` brings scenes back, and `/wear wallpaper` says which way it is set (see Wallpapers). |
| `/wear <theme> --match` | Wears the theme and matches Claude Code's own theme to it, answering in full whatever happened. With the Match setting off, this, `/wear match` and the gallery's `match theme` button are the only ways a match is made. |
| `/wear match` | The same for the theme worn now. With the Match setting off, each gallery card has a `match theme` button that wears and matches at once. |
| `/wear default` | Back to Claude Code's own drawing. After a match, Claude Code's theme goes back to the one you had, unless you changed it yourself since the match: then your choice stands. In a pinned project it takes the look off that project alone, and gives the theme back only if the match was made there. |

Each command answers in a toast (an unknown theme's message stays longer). Nothing `/wear` says is added to the conversation, so it costs no tokens and never reaches the model.

Twenty-four looks, in five families:

| Family | Looks |
| --- | --- |
| everyday | `noir`, `paper` (light), `tokyo-night`, `dracula`, `catppuccin`, `solarized`, `nord` |
| tech | `phosphor`, `graphite`, `clay`, `synthwave`, `on-call` |
| sports | `hardwood` (basketball), `gridiron` (football), `rink` (hockey), each in your team's colours if you set them |
| seasons | `halloween`, `christmas`, `spring` (light), `summer`, `autumn`, and the holiday looks `easter` and `eid` |
| accessible | `high-contrast`, `colorblind` |

Short forms work too: `drac`, `hc`, `colourblind`, `tokyo night`, `xmas`, `fall`, `spooky`, `crt`, `pager`, `basketball`, `football`, `hockey`, `eid al fitr`, and any prefix that names one look alone (`sp` is spring, `su` is summer, `r` is rink).

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

### Tech looks

Five looks from the rooms and screens of people who build software: `phosphor` (green and amber phosphor on near-black, the old terminal, mark `▮`), `graphite` (dimmed greys and one calm blue, for long days of reading code, `◦`), `clay` (terracotta, sand and sage on warm charcoal, `◒`), `synthwave` (magenta and cyan on indigo, `◢`) and `on-call` (pager amber and red on graphite, for the night shift, `◉`). Each has its own verbs on the spinner, its own costume for Bolt and its own scene.

### Sports looks and your team

Three looks, a sport each: `hardwood` (basketball: maple, orange and arena lights), `gridiron` (football: night turf, chalk lines and goalpost yellow) and `rink` (hockey: ice blue and the red line). They name a sport, never a league or a team; the team is yours to bring.

- **Team colours.** Set `teamPrimary` and `teamSecondary` to your team's two colours as hex codes (`#1f4e9c`, `f2b824` and `#fc3` all read). Every sports look then wears them in place of its own accent and special: the stripe on each row, the icons and chips in those colours, Bolt's costume, the desktop app's accents, and in the scene the seats, the banners and the painted lines. A colour too dark to read on the look is lightened only as far as reading takes (the scene paints from the colour as you gave it, blended a little toward the look so it sits in the picture), and `/wear` says so when the look goes on. One colour alone works; the other stays the look's own. The gallery shows the three looks as you will wear them.
- **Game day.** Set `gameDay` to the weekdays your team plays (`sunday`, `sat sun`, `mon, thu`) and `gameLook` to the look. On those days `/wear auto` and `/wear season` wear the game look, all day, and go back at midnight; `/wear` says "game day" where it names what is worn. A look you put on by name stays on, game day or not.

### Holiday looks

Two looks for two holidays, each a place and its light, with no figures and no words: `easter` (dawn gold, lily white and blossom on a violet morning, mark `⚘`) and `eid` (Eid al-Fitr: lantern gold and a crescent over a teal night, `☽`). Both are worn by name on any day, like every look.

`/wear season` wears one only where you ask: the `seasonEaster` setting wears `easter` from Good Friday to Easter Monday, by the Western date; the `seasonEid` setting wears `eid` on Eid al-Fitr and the two days after. Eid follows the sighting of the new moon, so wardrobe carries the Umm al-Qura calendar's dates through 2040, and where you live the day may fall a day either side; past the table the look is still there by name. Both settings are off as installed.

### Bolt in costume

Bolt, the modmyclaude mascot, wears each theme: in the gallery beside every card, beside the line that names what is worn, and in the switch band. A costume is an accessory drawn over the sprite, never a change to it: a witch hat for `halloween`, a santa hat for `christmas`, a flower crown for `spring`, sunglasses for `summer`, a beanie for `autumn`, a cape and fangs for `dracula`, cat ears for `catppuccin`, a headband for `tokyo-night`, a fedora for `noir`, reading glasses for `paper`, a sun visor for `solarized`, a beanie with a pom for `nord`, a bow tie for `high-contrast`, a terminal visor for `phosphor`, headphones for `graphite`, a sun hat for `clay`, shutter shades for `synthwave`, a headset for `on-call`, a sweatband for `hardwood`, a helmet for `gridiron`, a helmet and stick for `rink`, a lily for `easter` and a lantern for `eid`; `colorblind` leaves Bolt plain. The three sports costumes are in the look's accent and special, so they are in your team's colours once you set them. Every costume takes at most three colours, all from the theme's own palette, keeps the antenna light clear (each hat has a notch around it), and never uses Bolt's own pink or blush. `tests/costume.test.ts` holds every one of those rules for every theme and pose.

### The app wears the look (desktop app)

In the desktop app a look reaches past the rows wardrobe draws: the app itself takes the look's palette. The page, cards, panels and menus, the text, the borders and the accent, danger, success and warning colours are all made from the look's own colours, in the look's light or dark mode, and five looks pair with the code highlighting theme of the same name (`dracula`, `nord`, `tokyo-night`, `solarized`, `catppuccin`). The main text stands at least 7:1 on every surface of every look, and the quiet text 4.5:1. `/wear default` hands the app back its own colours.

### Wallpapers (desktop app)

Every look has a scene, drawn behind the chat in the desktop app, with Bolt in the look's costume standing at the right. The app frosts the chat column over the middle of the window, so every scene is composed around it: what the scene is about stands at the two sides, where it is seen sharp, and only soft light sits behind the words.

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
| `phosphor` | A dim machine room: a green terminal on a desk, its cursor blinking, an amber one farther back, a wall of reel cabinets with status lights, slow scanlines. |
| `graphite` | A commit graph as constellations: a blue main line, branches and merges drifting over a dot grid, a monitor, books and a plant on the desk. |
| `clay` | Desert dunes at dusk: a low sun, a mesa and buttes, cacti and agave, three clay pots, birds crossing, the first stars. |
| `synthwave` | A banded sun over a grid floor running to the horizon, faceted mountains, palms and light trails. |
| `on-call` | An operations room at night: a wall of dashboards with heartbeat traces and status lights, two monitors, a pager glowing red, a mug and a rubber duck. |
| `hardwood` | An empty basketball arena under the lights: a maple floor with its painted lanes and arcs, a hoop at each end, tiers of seats in two colours, plain banners, a glowing scoreboard and one ball bouncing. |
| `gridiron` | A football stadium at night: a striped field with chalk yard lines, an end zone in colour at each end, yellow goalposts, floodlight towers over stands full of small lights, low mist and a ball spiralling across the sky. |
| `rink` | A hockey rink under arena lights: bright ice with its lines and face-off circles, boards with glass above, a net at each end, tiers of seats in two colours, banners, skate traces and a puck sliding. |
| `halloween` | A haunted house under a crescent moon, glowing pumpkins, ghosts, an owl, a spider on its web, bats and embers. |
| `christmas` | A village under snow-capped mountains, a decorated tree with gifts, a snowman, string lights, and a sleigh crossing the moon. |
| `spring` | A cherry branch in blossom over a meadow, a stream, tulips and daisies, butterflies and drifting petals. |
| `summer` | Sunset over the sea: a sailboat, an island, gulls, palms, lanterns on a string and a surfboard in the sand. |
| `autumn` | A low sun over forested ridges, geese in a V, hay bales, a scarecrow and tumbling leaves. |
| `easter` | Easter morning: dawn gold rising behind violet hills, three small crosses on a far hill, a rock tomb with its stone rolled aside and soft light within, a garden of white lilies between cypresses. |
| `eid` | The night of Eid al-Fitr: a thin crescent over a skyline of domes and minarets with warm lit arches, strings of lanterns across a teal sky, a gateway with one great lantern and a potted palm. |

Most scenes are drawn in three layers of depth (far, middle, near) that sway gently against each other; `paper`, `solarized` and `high-contrast` are flat on purpose. The three sports scenes paint their seats, banners and lines in your team's colours where you set them. The scene comes on with the look and switches with it, `/wear auto` and `/wear season` included; `/wear default` takes it down with the look.

Scenes are pure vector, animated slowly and never flashing, and under the system's reduced-motion setting they stand still, whole. The `motion` setting is yours besides: `calm` keeps half of what drifts and moves everything at half the speed, and `still` draws the whole picture at rest. The chat sits on frosted glass tinted with the look's background; the `glass` setting makes it lighter (more of the scene) or heavier (less), and the two accessibility looks use a heavier glass that never goes lighter, so text keeps its contrast.

Every scene also stands in the light of your local hour. Each is painted at an hour of its own: `easter` at dawn; `spring`, `paper`, `hardwood` and `rink` by day; `summer`, `autumn`, `clay`, `synthwave` and `catppuccin` at dusk; the rest at night. From there your clock moves the light on: night comes down over a scene painted by day, day lifts the sky of one painted at night, and dawn and dusk each bring a warm glow, low at the left at dawn and low at the right at dusk. A scene painted at dawn or dusk has its own low sun and takes no second glow. Dawn and dusk are each two and a half hours long, about the `dayStarts` and `nightStarts` hours (dawn from 05:30 to 08:00 and dusk from 17:30 to 20:00 as installed), and the light moves in steps of a quarter of an hour; all day and all night it stands still. The light falls at the two sides of the picture only, so the chat column keeps the look's own light and the words on it their contrast. The two accessibility looks take none of it, the rooms, the two arenas, the orrery and the two looks on a light page take less, and a gallery picture is always as painted. The `clockLight` setting turns it off.

Six looks also play on the graphics card. With one of them worn and `motion` at `full`, the desktop app plays a second layer over the look's scene. Each answers three things: your pointer, a press on the bare scene (anywhere outside the chat and the panels), and whether Claude is working. Every one also puts a soft light around the prompt box, brighter while Claude works.

| Look | Over the scene | Your pointer | A press on the bare scene | While Claude works |
| --- | --- | --- | --- | --- |
| `christmas` | Snow falling in depth. | The snow parts around it. | The snow blows outward from there. | It falls faster and aslant, and the tree glows. |
| `noir` | Hard rain. | Dry in a ring around it, and over the bare scene the searchlight on the left roofs turns to follow it. | Sheet lightning from there. | The rain thickens and leans, the searchlight sweeps faster. |
| `tokyo-night` | Light rain lit pink, cyan and violet. | A violet lantern that lights the rain near it. | A ring of light runs out from there. | More rain, and the haze of the signs swells in both wings. |
| `nord` | Three curtains of aurora, and ice crystals that glitter in the air. | The aurora is brightest above it, and crystals near it shine. | A fold of light runs along the curtains from there. | The aurora brightens and flows faster. |
| `halloween` | Embers rising from the pumpkin patch, and low violet fog. | Embers gather and circle it, and the fog opens around it. | The fire flares and throws the embers outward. | More embers, and the firelight on the patches grows. |
| `summer` | The sea glinting, the sun's path glittering on it, fireflies among the palms. | A glitter on the water under it, and the fireflies shy away. | Every firefly lights, and a press on the water spreads rings from there. | The sun's path widens and brightens, and more fireflies come out. |

The vector scene stays whole beneath each one and shows alone under the system's reduced-motion setting, with `motion` at `calm` or `still`, and wherever the app plays no shader. Claude Code's own check of each file says it runs on any graphics card, at 30 frames a second. The app follows the pointer itself: wardrobe hears nothing of it.

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

Every setting has a default, so the notice at install about options not yet set is expected. Set these in `/config`. A value wardrobe cannot read (a time, a colour, a weekday) falls back to its default, and `/wear` names it.

| Setting | Default | Meaning |
| --- | --- | --- |
| `dayTheme` | `paper` | What `/wear auto` wears by day. |
| `nightTheme` | `tokyo-night` | What `/wear auto` wears by night. |
| `dayStarts` | `07:00` | When the day starts, 24-hour local time. |
| `nightStarts` | `19:00` | When the night starts. A day that crosses midnight (`20:00` to `06:00`) works. |
| `matchTheme` | on | Putting a look on also sets Claude Code's own theme to match it (see Matching Claude Code's theme). Off, only `--match`, `/wear match` and the gallery's `match theme` button do. |
| `teamPrimary` | empty | Your team's main colour as a hex code. The sports looks wear it as their accent. Empty keeps each look's own. |
| `teamSecondary` | empty | Your team's second colour. The sports looks wear it as their special colour. |
| `gameDay` | empty | The weekdays your team plays, in words: `sunday`, `sat sun`. On those days `/wear auto` and `/wear season` wear the game look. |
| `gameLook` | `hardwood` | The sports look a game day wears: `hardwood`, `gridiron` or `rink`. |
| `motion` | `full` | How much the scene behind the chat moves: `full`, `calm` or `still`. |
| `glass` | `default` | How heavily the desktop app frosts its panels over the scene: `light`, `default` or `heavy`. |
| `seasonEaster` | off | `/wear season` wears `easter` from Good Friday to Easter Monday. |
| `seasonEid` | off | `/wear season` wears `eid` on Eid al-Fitr and the two days after. |
| `clockLight` | on | The scene behind the chat takes the light of your local hour: a glow at dawn and dusk, dark at night. Off keeps every scene as painted. |

## What it can touch

- Its own store: the global choice, the per-project pins (keyed by the path of the folder the session started in), and, once a theme is matched, the Claude Code theme you had before, the one it set, and the pinned project the match was made in if it was made in one, so `/wear default` can put yours back and can tell when you changed it since.
- For the session, in memory: each tool call's start and end time, for its row; for the scenes on the graphics card, whether a turn runs now; and the light of the local hour, for the scene behind the chat.
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
- Team colours change what wardrobe draws and what the desktop app wears. The Claude Code theme file a sports look matches (`themes/<look>.json`) keeps the look's own colours, so in a terminal the input box border stays the look's.
- A game day runs from midnight to midnight, local time, and only moves `auto` and `season`. There is one game look and one team for every project.
- Easter is the Western date. Eid al-Fitr is the Umm al-Qura calendar's date, which a local sighting of the moon may move a day either way, and the table ends in 2040.
- The switch band is a plain row above the prompt: it never covers a safety hold or a survey, and Bolt is left out of it under 60 columns.
- Tool calls made before wardrobe loaded show no time, and a refused or failed call shows its status but no time.
- The app's palette and the wallpapers need the desktop app on Claude Code 2.1.325 or newer; the terminal, VS Code and the mobile app never draw them, and `/wear wallpaper` says so where nothing does. On an older Claude Code the hook that draws the scene never runs, and the rest of wardrobe is unchanged.
- Claude Code keeps one theme per session, and the latest plugin to set it wins: when another plugin's scene appears over wardrobe's, a toast says so once, and `/wear <theme>` puts wardrobe's back, palette and scene.
- A mod that lays something over the scene, such as cards of live scores in a side column, shows on top of wardrobe's scene whichever of the two the app asks first; the scene keeps playing beneath it.
- The desktop app ignores a whole palette it finds one unreadable pair of text in, and says nothing when it does. `tests/app-colors.test.ts` holds every look's palette to the helper's own check, so none should be refused; if the app keeps its own colours under a look, that is the first place to look.
- Claude Code has one `theme` setting for every session on the machine. A pinned project wearing a different look keeps its rows and scene and shares that one setting, so its terminal theme may not match its look unless you match it there with `--match`, which then sets the theme for every session.
- Claude Code keeps one theme per session and does not say whose it is. Where another plugin set a theme with no scene after wardrobe's, `/wear default` cannot see it and clears it with its own.
- The gallery's scene pictures show in the desktop app only; the terminal's gallery is unchanged.
- Under the system's reduced-motion setting the desktop app takes the animation out, and every scene rests whole: nothing in a scene is only visible mid-animation.
- The hour's light goes by your machine's clock and the two hours you set (`dayStarts`, `nightStarts`), not by where the sun stands where you live. The clock is read once a minute, so a new step of the light shows within a minute. Each step sets the scene again, a few times an hour at dawn and dusk and never between, and the scene's slow motion may start over when it does.
- Not verified: the paint itself in a real terminal and in the desktop app, the palettes and wallpapers included, how smoothly the fuller scenes animate on a slow machine, and the look and speed of the six scenes on a real graphics card (their cost is Claude Code's own estimate; they were judged on a stand-in that plays the same files on the processor), and the hour's light in the real app (it was judged on stills made in a browser, under a stand-in for the frosted column). The tests check the drawn trees against each surface's rules, every scene against the backdrop's rules and every palette against the helper's check, not pixels.

## Built from a prompt

This mod was built from [prompts/wardrobe.md](../../prompts/wardrobe.md).

More mods: [the full catalogue](../../README.md#the-mods).
