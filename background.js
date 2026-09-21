(() => {
  const api = globalThis.browser || globalThis.chrome;
  const HLTB_INIT_URL = "https://howlongtobeat.com/api/search/site/init";
  const HLTB_SEARCH_URL = "https://howlongtobeat.com/api/search/site";
  const HLTB_GAME_URL = "https://howlongtobeat.com/game/";
  const HLTB_ORIGIN_PATTERN = "https://howlongtobeat.com/*";
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const FAILURE_TTL = 15 * 60 * 1000;
  const inFlight = new Map();
  const MAX_TRANSIENT_RETRIES = 2;
  const MAX_RETRY_DELAY_MS = 3000;
  let sessionToken = null;

  class HltbServiceError extends Error {
    constructor(message, status = null) {
      super(message);
      this.name = "HltbServiceError";
      this.reason = "service-error";
      this.status = status;
    }
  }

  function isRetryableStatus(status) {
    return status === 429 || status >= 500;
  }

  function retryDelayMs(response, attempt) {
    const retryAfter = response?.headers?.get?.("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
      const dateMs = Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(dateMs)) return Math.max(0, dateMs);
    }
    return Math.min(MAX_RETRY_DELAY_MS, 250 * (2 ** attempt));
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function fetchWithRetries(url, initFactory) {
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      let response;
      try {
        response = await fetch(url, initFactory(attempt));
      } catch (error) {
        if (attempt === MAX_TRANSIENT_RETRIES) {
          throw new HltbServiceError(error?.message || "HowLongToBeat request failed");
        }
        await wait(Math.min(MAX_RETRY_DELAY_MS, 250 * (2 ** attempt)));
        continue;
      }
      if (response.ok || !isRetryableStatus(response.status)) return response;
      if (attempt === MAX_TRANSIENT_RETRIES) {
        throw new HltbServiceError(`HowLongToBeat HTTP ${response.status}`, response.status);
      }
      const delay = retryDelayMs(response, attempt);
      if (delay > MAX_RETRY_DELAY_MS) throw new HltbServiceError("HowLongToBeat requests a longer pause. Try again later.", response.status);
      await wait(delay);
    }
    throw new HltbServiceError("HowLongToBeat request failed");
  }
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
        const response = await fetchWithRetries(`${HLTB_INIT_URL}?t=${Date.now()}`, () => ({
          headers: { accept: "application/json" },
          credentials: "omit",
          referrer: "https://howlongtobeat.com/",
          referrerPolicy: "strict-origin-when-cross-origin",
          signal: AbortSignal.timeout(20000)
        }));
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

  async function findConfirmedCandidate(appId, candidates) {
    const direct = candidates.find((candidate) => steamIdsFromResult(candidate).includes(String(appId)) && toMetrics(candidate).length > 0);
    if (direct) return direct;
    const possible = candidates.filter((candidate) => candidate?.game_type === "game" || !candidate?.game_type).slice(0, 5);
    for (const candidate of possible) {
      if (!candidate?.game_id) continue;
      const response = await fetchWithRetries(`${HLTB_GAME_URL}${encodeURIComponent(candidate.game_id)}`, () => ({
        headers: { accept: "text/html,application/xhtml+xml" },
        credentials: "omit",
        referrer: "https://howlongtobeat.com/",
        referrerPolicy: "strict-origin-when-cross-origin",
        signal: AbortSignal.timeout(20000)
      }));
      if (response.status === 404) continue;
      if (!response.ok) throw new HltbServiceError(`HowLongToBeat detail HTTP ${response.status}`, response.status);
      const detail = getDetailGame(await response.text());
      if (!detail || !steamIdsFromResult(detail).includes(String(appId))) continue;
      return { ...candidate, ...detail };
    }
    return null;
  }

  async function searchCandidates(token, queryText) {
    const request = (currentToken) => {
      const payload = { ...buildPayload(queryText), useCache: true, [currentToken.hpKey]: currentToken.hpVal };
      return fetchWithRetries(HLTB_SEARCH_URL, () => ({
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-auth-token": currentToken.token,
          "x-hp-key": currentToken.hpKey,
          "x-hp-val": currentToken.hpVal
        },
        body: JSON.stringify(payload),
        credentials: "omit",
        referrer: "https://howlongtobeat.com/",
        referrerPolicy: "strict-origin-when-cross-origin",
        signal: AbortSignal.timeout(20000)
      }));
    };

    let response = await request(token);
    if (response.status === 403) {
      token = await getSessionToken(true);
      response = await request(token);
    }
    if (!response.ok) throw new HltbServiceError(`HowLongToBeat search HTTP ${response.status}`, response.status);
    const body = await response.json();
    if (!Array.isArray(body?.data)) throw new HltbServiceError("Invalid HowLongToBeat search response");
    return body.data;
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
        const confirmed = await findConfirmedCandidate(appId, allCandidates);
        if (confirmed && toMetrics(confirmed).length > 0) {
          return { ok: true, metrics: toMetrics(confirmed), hltbId: String(confirmed.game_id), matchedTitle: confirmed.game_name };
        }
      }
    }

    const result = await findConfirmedCandidate(appId, allCandidates);
    if (!result || !toMetrics(result).length) return { ok: false, reason: "no-id-match" };
    return { ok: true, metrics: toMetrics(result), hltbId: String(result.game_id), matchedTitle: result.game_name };
  }

  function shouldPersistResult(result) {
    return Boolean(result?.ok || result?.reason === "no-id-match");
  }

  async function cleanupExpiredCache() {
    if (!api?.storage?.local) return;
    const stored = await api.storage.local.get(null);
    const expiredKeys = Object.entries(stored || {})
      .filter(([key, value]) => key.startsWith("hltb:v3:") && value?.cachedAt)
      .filter(([, value]) => Date.now() - value.cachedAt > (value.ok ? CACHE_TTL : FAILURE_TTL))
      .map(([key]) => key);
    if (expiredKeys.length) await api.storage.local.remove(expiredKeys);
  }

  async function getCached(key, title) {
    if (!api?.storage?.local) return null;
    const stored = await api.storage.local.get(key);
    const value = stored?.[key];
    if (!value || !shouldPersistResult(value)) return null;
    // Matches are confirmed by Steam AppID, so a hit stays valid whatever title
    // the current page language produced; a failed search only serves the same
    // title so another language can still retry with its own.
    const expired = Date.now() - value.cachedAt > (value.ok ? CACHE_TTL : FAILURE_TTL);
    const titleChanged = !value.ok && normalize(value.title) !== normalize(title);
    if (expired || titleChanged) {
      api.storage.local.remove(key).catch(() => {});
      return null;
    }
    return { ...value, source: "cache" };
  }

  async function fetchAndCache(key, appId, title, persist = true) {
    const cached = persist ? await getCached(key, title) : null;
    if (cached) return cached;
    const result = await queryHltb(appId, title).catch((error) => ({
      ok: false,
      reason: "service-error",
      detail: String(error?.message || error)
    }));
    const value = { ...result, appId: String(appId), title, cachedAt: Date.now() };
    if (persist && api?.storage?.local && shouldPersistResult(value)) {
      await api.storage.local.set({ [key]: value });
      api.storage.local.remove([`hltb:${appId}`, `hltb:v2:${appId}`]).catch(() => {});
    }
    return value;
  }

  async function hasHostPermission() {
    try {
      const granted = await api?.permissions?.contains?.({ origins: [HLTB_ORIGIN_PATTERN] });
      return granted !== false;
    } catch {
      return true;
    }
  }

  async function handleMessage(message, sender) {
    // HLTB's API sends no CORS headers, so without the granted host permission
    // Firefox blocks reading every response before the server is even reached.
    if (!(await hasHostPermission())) {
      return { ok: false, reason: "no-permission" };
    }
    const appId = String(message.appId);
    const title = String(message.title).trim().slice(0, 160);
    const isPrivate = sender?.tab?.incognito === true;
    if (isPrivate) {
      return fetchAndCache(null, appId, title, false);
    }

    await cleanupExpiredCache().catch(() => {});
    const key = `hltb:v3:${appId}`;
    if (!inFlight.has(key)) inFlight.set(key, fetchAndCache(key, appId, title).finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  }

  api?.runtime?.onMessage?.addListener((message, sender) => {
    if (message?.type === "open-options") {
      api?.runtime?.openOptionsPage?.();
      return;
    }
    if (!message || message.type !== "get-hltb" || !/^\d+$/.test(String(message.appId || "")) || !message.title) {
      return; // Return undefined synchronously so other listeners or internal messaging are not blocked
    }
    return handleMessage(message, sender);
  });

  const testExports = { isRetryableStatus, shouldPersistResult };
  if (typeof module !== "undefined" && module.exports) module.exports = testExports;
})();
