(() => {
  const api = globalThis.browser || globalThis.chrome;
  const HLTB_INIT_URL = "https://howlongtobeat.com/api/find/init";
  const HLTB_SEARCH_URL = "https://howlongtobeat.com/api/find";
  const HLTB_GAME_URL = "https://howlongtobeat.com/game/";
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const FAILURE_TTL = 15 * 60 * 1000;
  const inFlight = new Map();
  let sessionToken = null;

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9а-яіїєґ]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function steamIdsFromResult(result) {
    return [result?.profile_steam, result?.profile_steam_alt, result?.steam_appid, result?.steamAppId, result?.app_id, result?.appId]
      .map((value) => String(value ?? "").trim())
      .filter((value) => /^\d+$/.test(value) && value !== "0");
  }

  function hoursFromSeconds(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.round((seconds / 3600) * 10) / 10;
  }

  function toMetrics(result) {
    return [
      ["Main Story", hoursFromSeconds(result?.comp_main)],
      ["Story and Extras", hoursFromSeconds(result?.comp_plus)],
      ["Completionist", hoursFromSeconds(result?.comp_100)]
    ].filter(([, hours]) => hours).map(([displayLabel, hours]) => ({ displayLabel, hours }));
  }

  function buildPayload(title) {
    return {
      searchType: "games",
      searchTerms: title.split(/\s+/).filter(Boolean),
      searchPage: 1,
      size: 20,
      searchOptions: {
        games: {
          userId: 0,
          platform: "",
          sortCategory: "popular",
          rangeCategory: "main",
          rangeTime: { min: null, max: null },
          gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
          rangeYear: { min: "", max: "" },
          modifier: ""
        },
        users: { sortCategory: "postcount" },
        lists: { sortCategory: "follows" },
        filter: "",
        sort: 0,
        randomizer: 0
      }
    };
  }

  async function getSessionToken() {
    if (sessionToken && Date.now() - sessionToken.createdAt < 10 * 60 * 1000) return sessionToken;
    const response = await fetch(`${HLTB_INIT_URL}?t=${Date.now()}`, {
      headers: { accept: "application/json" },
      credentials: "omit",
      referrer: "https://howlongtobeat.com/",
      referrerPolicy: "strict-origin-when-cross-origin",
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`HLTB init HTTP ${response.status}`);
    const token = await response.json();
    if (!token?.token || !token?.hpKey || !token?.hpVal) throw new Error("HLTB init response is missing session fields");
    sessionToken = { ...token, createdAt: Date.now() };
    return sessionToken;
  }

  function getDetailGame(html) {
    const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;
    try {
      const data = JSON.parse(match[1]);
      return data?.props?.pageProps?.game?.data?.game?.[0] || null;
    } catch { return null; }
  }

  async function findConfirmedCandidate(appId, title, candidates, token) {
    const direct = candidates.find((candidate) => steamIdsFromResult(candidate).includes(String(appId)) && toMetrics(candidate).length > 0);
    if (direct) return direct;
    const possible = candidates.filter((candidate) => candidate?.game_type === "game" || !candidate?.game_type).slice(0, 5);
    for (const candidate of possible) {
      if (!candidate?.game_id) continue;
      const response = await fetch(`${HLTB_GAME_URL}${encodeURIComponent(candidate.game_id)}`, {
        headers: { accept: "text/html,application/xhtml+xml" },
        credentials: "omit",
        referrer: "https://howlongtobeat.com/",
        referrerPolicy: "strict-origin-when-cross-origin",
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) continue;
      const detail = getDetailGame(await response.text());
      if (!detail || !steamIdsFromResult(detail).includes(String(appId))) continue;
      return { ...candidate, ...detail };
    }
    return null;
  }

  async function queryHltb(appId, title) {
    const token = await getSessionToken();
    const payload = { ...buildPayload(title), useCache: true, [token.hpKey]: token.hpVal };
    const response = await fetch(HLTB_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-auth-token": token.token,
        "x-hp-key": token.hpKey,
        "x-hp-val": token.hpVal
      },
      body: JSON.stringify(payload),
      credentials: "omit",
      referrer: "https://howlongtobeat.com/",
      referrerPolicy: "strict-origin-when-cross-origin",
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`HLTB search HTTP ${response.status}`);
    const body = await response.json();
    const candidates = Array.isArray(body?.data) ? body.data : [];
    // Search is discovery only. AppID confirmation comes from profile_steam in detail data.
    const result = await findConfirmedCandidate(appId, title, candidates, token);
    if (!result || !toMetrics(result).length) return { ok: false, reason: "no-id-match" };
    return { ok: true, metrics: toMetrics(result), hltbId: String(result.game_id), matchedTitle: result.game_name };
  }

  async function getCached(key, title) {
    if (!api?.storage?.local) return null;
    const stored = await api.storage.local.get(key);
    const value = stored?.[key];
    if (!value || normalize(value.title) !== normalize(title) || Date.now() - value.cachedAt > (value.ok ? CACHE_TTL : FAILURE_TTL)) return null;
    return { ...value, source: "cache" };
  }

  async function fetchAndCache(key, appId, title) {
    const cached = await getCached(key, title);
    if (cached) return cached;
    const result = await queryHltb(appId, title).catch((error) => ({ ok: false, reason: "network", detail: String(error?.message || error) }));
    const value = { ...result, appId: String(appId), title, cachedAt: Date.now() };
    if (api?.storage?.local) await api.storage.local.set({ [key]: value });
    return value;
  }

  async function handleMessage(message) {
    if (!message || message.type !== "get-hltb" || !/^\d+$/.test(String(message.appId || "")) || !message.title) return undefined;
    const appId = String(message.appId);
    const title = String(message.title).trim().slice(0, 160);
    const key = `hltb:${appId}`;
    if (!inFlight.has(key)) inFlight.set(key, fetchAndCache(key, appId, title).finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  }

  api?.runtime?.onMessage?.addListener(handleMessage);
})();
