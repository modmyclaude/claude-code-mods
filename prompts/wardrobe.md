---
mod: wardrobe
title: Wardrobe
tagline: Restyle Claude Code live: twenty-four looks, a moving scene behind the chat in the desktop app, and colourblind-safe and high-contrast themes.
category: looks
surfaces: [terminal, desktop]
model_calls: none
full_from: 2.1.325
---

# Wardrobe

Restyle Claude Code live: twenty-four looks, a moving scene behind the chat in the desktop app, and colourblind-safe and high-contrast themes.

## The prompt

Paste this into Claude Code to build it yourself, or install the finished mod from this repo.

```text
Build me a Claude Code mod called "wardrobe" that restyles how Claude Code draws its work, switchable live.

What it does
- /wear <theme> switches theme instantly, and shows a themed band above the prompt for a few seconds so the switch is unmistakable: the theme's background colour, its mark, "wearing <theme>", its tool icons, and the mascot in that theme's costume.
- /wear with no argument opens a gallery: a card per theme with a sample tool row drawn in that theme, its diff chips, the mascot in costume, and a "wear" button.
- Restyle what a mod is allowed to draw: tool rows (a one-cell accent stripe, an icon per tool, plus timing), tool results, diff cards, the spinner and the turn duration.
- Themes: noir, paper (light), tokyo-night, dracula, catppuccin, solarized, nord.
- Seasonal packs with their own palettes, marks and icons: halloween, christmas, spring (light), summer, autumn. /wear season picks one by the date (Oct 15 to Nov 1 halloween; Dec 1 to Jan 6 christmas; Mar to May spring; Jun to Aug summer; Sep to Nov autumn; the rest of winter nord) and re-checks the calendar daily.

What is new here
- Two accessibility themes: "high-contrast" (WCAG AAA text contrast) and "colorblind" (diffs in blue and orange instead of red and green, tool icons that differ by shape, not only colour). Check every theme, the seasonal packs included, for diff contrast.
- The mascot in costume: an accessory per theme (a witch hat, a santa hat, a flower crown, sunglasses, a cape and fangs, cat ears ...) drawn over the sprite, never a change to it; the antenna light stays clear and the costume uses at most three colours from the theme's palette.
- auto mode: a light theme by day and a dark theme by night, with the switch times as settings.
- /wear pin saves the current theme for this project only; other projects keep the global theme.
- In the desktop app, the app itself wears the theme: a palette for its page, panels, text and accents, made from the theme's own colours with the palette helper your looks guide tells you to copy in, the main text at least 7:1 on every surface. Check that the app will paint every palette: it ignores one with an unreadable pair and says nothing.
- In the desktop app, a wallpaper per theme: an animated scene behind the chat, drawn in three layers of depth that sway against each other (a rooftop in the rain for noir, a castle against the moon for dracula, a village in the snow with a sleigh crossing the moon for christmas), the mascot in costume standing at the right, set with the theme and switched with it. The gallery shows each scene, small and still. /wear wallpaper off keeps the theme and drops the scene. Scenes are pure vector, slow, never flashing, and whole when the system asks for reduced motion. Needs Claude Code 2.1.325 or newer; the terminal never draws them.
- In the desktop app, six flagship scenes also play on the GPU, each a shader file over the same picture (`hooks/gpu/<name>.ts`, named in a literal `Shader` element, one branch a look): christmas (snow in depth), noir (hard rain, a searchlight that follows the pointer over the bare scene, sheet lightning on a press), tokyo-night (neon-lit rain, sign haze, a ring of light on a press), nord (aurora curtains and glittering ice crystals), halloween (embers that gather about the pointer, rolling fog, firelight) and summer (glitter on the sea, rings on the water on a press, fireflies). Every one reads the pointer itself (no hook hears it), takes one value from the mod (whether you work, which makes each scene livelier), and puts a soft light around the prompt box. The picture stays whole beneath it, for reduced motion and for an app that plays no shader, and calm or still motion keeps to the picture.
- In the desktop app, every scene stands in the light of my local hour. Each scene is painted at an hour of its own (a dawn, a day, a dusk or a night) and my clock moves the light on from there, as a wash laid over the finished picture and never a second drawing: night comes down over a day scene, day lifts the sky of a night scene, and dawn and dusk each glow low at one side, about the day and night hours of auto mode. Move the light in steps of a quarter of an hour and write state only when it moves, so nothing redraws all day or all night. Keep the wash to the two sides of the picture so the chat column keeps its own light and the words their contrast, leave the two accessibility looks alone, keep the gallery pictures as painted, and give me a setting that turns it off.
- Putting a theme on also sets Claude Code's own theme setting to match it, said once with how to undo it; remember the theme I had and put it back on /wear default, leave alone a theme I pick myself afterwards, and give me a setting that turns the matching off. There is one theme setting for every session on my machine, so a pinned project never changes it unless I ask there with --match.
- /wear <theme> everywhere wears it in every project and lets every project pin go; sessions already open follow within a minute.
- More looks, each with its own palette, mark, icons, spinner verbs, mascot costume and scene: five tech looks (phosphor, a green and amber terminal; graphite, dimmed greys and one blue; clay, terracotta and sand on warm charcoal; synthwave, magenta and cyan on indigo; on-call, pager amber and red on graphite), three sports looks that name a sport and never a league or a team (hardwood for basketball, gridiron for football, rink for hockey), and two holiday looks that are places and light with no figures and no words (easter, a dawn garden; eid, lanterns and a crescent over a night skyline).
- My team: two settings for my team's two colours as hex codes. The sports looks wear them as their accent and special colour on the rows, the costume, the app's palette and the scene's seats, banners and lines. Lighten a colour only as far as it takes to read on the look, and tell me when you did. A game day setting (weekdays in words) and a game look: on those days auto and season wear the game look; a look I put on by name stays.
- /wear season wears easter (Good Friday to Easter Monday, the Western date) and eid (Eid al-Fitr and the two days after, from a table of the Umm al-Qura dates, since the day follows the moon) only where a setting each asks; both are off as installed and both looks are worn by name any day.
- The gallery shows one family at a time (everyday, tech, sports, seasons, accessible), a button per family, opening on the family of the look I wear.
- A motion setting (full, calm with half of what drifts at half the speed, still) and a glass setting (light, default, heavy; the accessibility looks never lighter).

Guardrails
- Display only: no files touched except the mod's own store, no processes, no network. The one setting it changes is Claude Code's own theme, to match the look, and it puts mine back.
- If a theme cannot draw something, fall back to Claude Code's own drawing instead of breaking the screen.
- The band draws under any other mod's band, never while a survey holds the band, and never over a safety hold. No emoji anywhere, no flashing.

Build rules
- Mods are new (Claude Code 2.1.287+). Use your plugin-authoring skill and read the types it points to before writing anything.
- Only do what is described here: no network calls and no reading files the mod does not need, unless this prompt says so.
- Write at least one test for the main behaviour and run `claude plugin validate` and `claude plugin test` until both pass.
- Load it in this session so I can try it, then take my changes in plain words.
- When I say it is good, install it so it loads in every session, and tell me where it lives and how to turn it off.
```
