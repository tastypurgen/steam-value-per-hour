# Privacy policy

Steam Value Per Hour is an independent Firefox add-on. It has no analytics, advertising, accounts, or telemetry.

When the add-on is active on a Steam game page, it sends the page's visible game title to HowLongToBeat to find playtime estimates. The Steam AppID is used locally to verify that the returned result matches the exact Steam game; it is not included in the search request. Requests are made from the extension background context over HTTPS. The add-on does not send Steam account credentials, page contents, browsing history, or private-window data to the developer.

Successful HowLongToBeat results and confirmed no-match results are cached in Firefox local extension storage. Successful results expire after 7 days, and no-match results after 15 minutes. Expired entries are removed during subsequent non-private lookups, so they may remain on disk longer while the extension is inactive. Service failures are not cached. The cache contains the Steam AppID, game title, playtime result or no-match status, and a timestamp. Private-window requests bypass local storage and the shared request cache.

The add-on reads the optional SteamDB price-history block already rendered on the page by the SteamDB extension when Advanced mode is enabled. It does not contact SteamDB directly.

Users can remove the local cache by removing the add-on or clearing its extension storage in Firefox. The add-on developer does not receive or retain the cached data.

This policy describes version 0.2.1. Changes to the data practices will be reflected here and in the Firefox Add-ons listing.
