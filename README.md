# Steam Value Per Hour

Firefox MV3 extension that calculates the cost of a Steam game per hour for
`Main Story`, `Story and Extras`, and `Completionist`.

## Modes

New installations use **Independent mode**. It reads the current regional price
from Steam and asks HowLongToBeat directly from the Firefox background context.
The extension requires a confirmed `profile_steam` AppID match in the HLTB
search result; a title that merely looks similar is never accepted as a match.
Results are cached locally for 24 hours and failed lookups are retried after a
short back-off. No history/record column is shown in this mode.

**Advanced mode** is optional in the extension settings. It reads the HLTB and
SteamDB blocks already rendered by Augmented Steam and SteamDB. When SteamDB data
is present, it uses the `2-year low` if available (falling back to `lowest recorded price`
when a 2-year history does not exist, such as for newly released games). If SteamDB is
absent or loading, the table still displays calculations for the current price.

Official Firefox Add-ons pages:

- [Augmented Steam](https://addons.mozilla.org/en-US/firefox/addon/augmented-steam/)
- [SteamDB](https://addons.mozilla.org/en-US/firefox/addon/steam-database/)

## Local installation for testing

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` from this directory.
4. Open or reload any Steam game page (e.g., `https://store.steampowered.com/app/1091500/Cyberpunk_2077/`).
5. To switch between **Default** and **Advanced** modes, click the extension icon in the browser toolbar to open the extension UI popup.

## Limitations

- HowLongToBeat has no official public API. The standalone mode uses the
  token-gated `/api/search/site` flow used by recent open-source clients, then checks
  `profile_steam` in the game's detail data. HLTB may change or block this
  endpoint; failures are shown as a status message and are not replaced with
  invented values.
- Search is discovery only. The table is shown only after a detail response
  confirms the Steam AppID, so an unrelated edition cannot be selected from
  title similarity alone.
- Advanced mode depends on the two optional Firefox extensions and their page
  markup. The absence of their blocks is treated as missing data, not proof
  that an extension is uninstalled.
- The metric is an estimate based on community-reported completion times.
