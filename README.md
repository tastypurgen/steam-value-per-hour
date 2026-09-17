# Steam Value Per Hour

Firefox MV3 extension that calculates the cost of a Steam game per hour for
`All PlayStyles`, `Main Story`, `Story and Extras`, and `Completionist`.

## Modes

Both modes use direct HowLongToBeat lookups from the Firefox background context,
requiring a confirmed `profile_steam` AppID match in the HLTB search result;
a title that merely looks similar is never accepted as a match. Results are
cached locally for 7 days, and failed lookups are retried after a short back-off.

- **Default (Independent) mode** (recommended): Reads the current regional price
  from Steam. It works without any other extensions and displays calculations for
  the current price.
- **Advanced mode**: In addition to current prices, it looks for the SteamDB block
  rendered on the store page by the SteamDB extension. When present, it uses the
  `2-year low` if available (falling back to `lowest recorded price` when a 2-year
  history does not exist). If SteamDB is absent or loading, the table still
  displays calculations for the current price.

Official Firefox Add-ons page for optional Advanced mode:

- [SteamDB](https://addons.mozilla.org/en-US/firefox/addon/steam-database/)

## Local installation for testing

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` from this directory.
4. Open or reload any Steam game page (e.g., `https://store.steampowered.com/app/1091500/Cyberpunk_2077/`).
5. To switch between **Default** and **Advanced** modes, click the extension icon in the browser toolbar to open the extension UI popup.

## Packaging for Firefox Add-ons (AMO)

To build a valid `.zip` distribution file preserving forward-slash path separators and directory hierarchy:

```powershell
tar -a -cf steam-value-per-hour-firefox-0.2.0.zip manifest.json background.js content.js options.html options.js options.css popup.html popup.js popup.css styles.css icons
```

To validate the package using Mozilla's official tools:

```bash
npx web-ext lint --source-dir .
```

## Disclaimer

Steam is a registered trademark of Valve Corporation. HowLongToBeat is a service of Ziff Davis. This add-on is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Valve Corporation, Steam, or HowLongToBeat.

