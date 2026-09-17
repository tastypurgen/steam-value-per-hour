(() => {
  const api = globalThis.browser || globalThis.chrome;
  const HLTB_INIT_URL = "https://howlongtobeat.com/api/search/site/init";
  const HLTB_SEARCH_URL = "https://howlongtobeat.com/api/search/site";
  const HLTB_GAME_URL = "https://howlongtobeat.com/game/";
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const FAILURE_TTL = 15 * 60 * 1000;
  const inFlight = new Map();
  let sessionToken = null;
  let sessionTokenPromise = null;

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
      ["All PlayStyles", hoursFromSeconds(result?.comp_all)],
      ["Main Story", hoursFromSeconds(result?.comp_main)],
      ["Story and Extras", hoursFromSeconds(result?.comp_plus)],
      ["Completionist", hoursFromSeconds(result?.comp_100)]
    ].filter(([, hours]) => hours).map(([displayLabel, hours]) => ({ displayLabel, hours }));
  }

  function cleanTitle(value) {
    return String(value || "")
      .replace(/[™®©]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9а-яіїєґ\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getSearchQueries(title) {
    const queries = [];
    const add = (t) => {
      const cleaned = cleanTitle(t);
      if (cleaned && !queries.includes(cleaned)) queries.push(cleaned);
    };

    add(title);
    const stripped = String(title || "")
      .replace(/[™®©]/g, "")
      .replace(/[:\-–—]\s*(?:\d{4}\s+)?(?:edition|deluxe|bundle|remastered|enhanced|definitive|goty|game of the year|complete|director's cut|directors cut|vr|collection).*$/i, "")
      .replace(/\b(?:\d{4}\s+)?(?:edition|deluxe|bundle|remastered|enhanced|definitive|goty|game of the year|complete|director's cut|directors cut|vr|collection)\b.*$/i, "");
    add(stripped);
    if (title.includes(":")) add(title.split(":")[0]);
    if (title.includes(" - ")) add(title.split(" - ")[0]);
    if (title.includes(" – ")) add(title.split(" – ")[0]);

    return queries;
  }

  function buildPayload(queryText) {
    const searchTerms = String(queryText || "").split(/\s+/).filter(Boolean);
    return {
      searchType: "games",
      searchTerms,
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

  async function getSessionToken(forceRefresh = false) {
    if (!forceRefresh && sessionToken && Date.now() - sessionToken.createdAt < 10 * 60 * 1000) return sessionToken;
    if (sessionTokenPromise && !forceRefresh) return sessionTokenPromise;

    sessionTokenPromise = (async () => {
      try {
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
      } finally {
        sessionTokenPromise = null;
      }
    })();

    return sessionTokenPromise;
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

  async function searchCandidates(token, queryText) {
    let payload = { ...buildPayload(queryText), useCache: true, [token.hpKey]: token.hpVal };
    let response = await fetch(HLTB_SEARCH_URL, {
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
    if (response.status === 403) {
      token = await getSessionToken(true);
      payload = { ...buildPayload(queryText), useCache: true, [token.hpKey]: token.hpVal };
      response = await fetch(HLTB_SEARCH_URL, {
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
    }
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data : [];
  }

  async function queryHltb(appId, title) {
    const token = await getSessionToken();
    const queries = getSearchQueries(title);
    const seenCandidateIds = new Set();
    const allCandidates = [];

    for (const query of queries) {
      const candidates = await searchCandidates(token, query);
      for (const candidate of candidates) {
        if (candidate?.game_id && !seenCandidateIds.has(candidate.game_id)) {
          seenCandidateIds.add(candidate.game_id);
          allCandidates.push(candidate);
        }
      }
      const direct = allCandidates.find((c) => steamIdsFromResult(c).includes(String(appId)) && toMetrics(c).length > 0);
      if (direct) {
        return { ok: true, metrics: toMetrics(direct), hltbId: String(direct.game_id), matchedTitle: direct.game_name };
      }
      if (candidates.length > 0) {
        const confirmed = await findConfirmedCandidate(appId, title, allCandidates, token);
        if (confirmed && toMetrics(confirmed).length > 0) {
          return { ok: true, metrics: toMetrics(confirmed), hltbId: String(confirmed.game_id), matchedTitle: confirmed.game_name };
        }
      }
    }

    const result = await findConfirmedCandidate(appId, title, allCandidates, token);
    if (!result || !toMetrics(result).length) return { ok: false, reason: "no-id-match" };
    return { ok: true, metrics: toMetrics(result), hltbId: String(result.game_id), matchedTitle: result.game_name };
  }

  async function getCached(key, title) {
    if (!api?.storage?.local) return null;
    const stored = await api.storage.local.get(key);
    const value = stored?.[key];
    if (!value) return null;
    const ttl = value.ok ? CACHE_TTL : (value.reason === "network" ? 30 * 1000 : FAILURE_TTL);
    if (Date.now() - value.cachedAt > ttl || normalize(value.title) !== normalize(title)) {
      api.storage.local.remove(key).catch(() => {});
      return null;
    }
    return { ...value, source: "cache" };
  }

  async function fetchAndCache(key, appId, title) {
    const cached = await getCached(key, title);
    if (cached) return cached;
    const result = await queryHltb(appId, title).catch((error) => ({ ok: false, reason: "network", detail: String(error?.message || error) }));
    const value = { ...result, appId: String(appId), title, cachedAt: Date.now() };
    if (api?.storage?.local) {
      await api.storage.local.set({ [key]: value });
      api.storage.local.remove([`hltb:${appId}`, `hltb:v2:${appId}`]).catch(() => {});
    }
    return value;
  }

  async function handleMessage(message) {
    const appId = String(message.appId);
    const title = String(message.title).trim().slice(0, 160);
    const key = `hltb:v3:${appId}`;
    if (!inFlight.has(key)) inFlight.set(key, fetchAndCache(key, appId, title).finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  }

  api?.runtime?.onMessage?.addListener((message) => {
    if (!message || message.type !== "get-hltb" || !/^\d+$/.test(String(message.appId || "")) || !message.title) {
      return; // Return undefined synchronously so other listeners or internal messaging are not blocked
    }
    return handleMessage(message);
  });
})();
