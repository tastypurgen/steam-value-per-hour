(() => {
  const WIDGET_ID = "svph-widget";
  const DEFAULT_MODE = "standalone";
  const DEFAULT_VISIBLE_METRICS = {
    "All PlayStyles": true,
    "Main Story": true,
    "Story and Extras": true,
    "Completionist": true
  };
  const PRICE_SELECTORS = [
    "#game_area_purchase .game_purchase_action .discount_final_price",
    "#game_area_purchase .game_purchase_action .game_purchase_price",
    ".game_area_purchase_game_wrapper .discount_final_price",
    ".game_area_purchase_game_wrapper .game_purchase_price"
  ];
  const api = globalThis.browser || globalThis.chrome || null;
  let settings = { mode: DEFAULT_MODE, visibleMetrics: { ...DEFAULT_VISIBLE_METRICS } };
  let hltbData = null;
  let hltbRequestKey = null;
  let lastSignature = null;
  let scheduled = false;
  let renderTimer;
  let observer;
  let stopTimer;

  const isVisible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0;

  function parseNumber(value) {
    const compact = value.replace(/[\s\u00a0]/g, "");
    const decimalIndex = Math.max(compact.lastIndexOf(","), compact.lastIndexOf("."));
    const normalized = decimalIndex === -1
      ? compact.replace(/[^\d]/g, "")
      : `${compact.slice(0, decimalIndex).replace(/[^\d]/g, "")}.${compact.slice(decimalIndex + 1).replace(/[^\d]/g, "")}`;
    return Number(normalized);
  }

  function getPurchaseBlock(element) {
    if (!element) return null;
    return element.closest(".game_area_purchase_game_wrapper")
      || element.closest(".game_area_purchase_game")
      || element;
  }

  function normalizeTitle(value) {
    return String(value || "")
      .replace(/[™®©]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9а-яіїєґ\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function stripEdition(value) {
    return String(value || "")
      .replace(/[:\-–—]\s*(?:\d{4}\s+)?(?:edition|deluxe|bundle|remastered|enhanced|definitive|goty|game of the year|complete|director's cut|directors cut|vr|collection).*$/i, "")
      .replace(/\b(?:\d{4}\s+)?(?:edition|deluxe|bundle|remastered|enhanced|definitive|goty|game of the year|complete|director's cut|directors cut|vr|collection)\b.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getPrice() {
    const rawAppName = document.querySelector(".apphub_AppName")?.textContent || "";
    const appName = normalizeTitle(rawAppName);
    const baseAppName = stripEdition(appName);
    const purchaseSections = [...document.querySelectorAll("#game_area_purchase .game_area_purchase_game")];

    let baseGameSection = purchaseSections.find((section) => {
      const heading = normalizeTitle(section.querySelector("h2.title, h1, h2")?.textContent || "");
      return appName && heading.includes(appName);
    });

    if (!baseGameSection && baseAppName && baseAppName.length >= 3) {
      baseGameSection = purchaseSections.find((section) => {
        const heading = normalizeTitle(section.querySelector("h2.title, h1, h2")?.textContent || "");
        const isAddon = /\b(soundtrack|ost|dlc|artbook|season pass|upgrade|expansion)\b/i.test(heading);
        return !isAddon && heading.includes(baseAppName);
      });
    }

    if (baseGameSection) {
      const priceElement = [...baseGameSection.querySelectorAll(".discount_final_price, .game_purchase_price")].find(isVisible);
      const label = priceElement?.textContent?.trim();
      const numericPart = label?.match(/[\d\s\u00a0.,]+/)?.[0];
      const amount = numericPart ? parseNumber(numericPart) : NaN;
      if (Number.isFinite(amount) && amount > 0) return { amount, currency: label.replace(numericPart, "").trim(), anchor: getPurchaseBlock(baseGameSection) };
    }
    for (const selector of PRICE_SELECTORS) {
      const element = [...document.querySelectorAll(selector)].find(isVisible);
      if (!element) continue;
      const label = element.textContent.trim();
      if (!label || /free to play|бесплатно/i.test(label)) continue;
      const numericPart = label.match(/[\d\s\u00a0.,]+/)?.[0];
      if (!numericPart) continue;
      const amount = parseNumber(numericPart);
      if (Number.isFinite(amount) && amount > 0) return { amount, currency: label.replace(numericPart, "").trim(), anchor: getPurchaseBlock(element) };
    }
    return null;
  }

  function getSteamDbPrice(basePrice = null) {
    const candidates = [
      ...document.querySelectorAll(".steamdb_prices, .steamdb_prices_top"),
      ...[...document.querySelectorAll("*")].filter((el) => {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        return /SteamDB lowest recorded price is/i.test(text) && ![...el.children].some((c) => /SteamDB lowest recorded price is/i.test(c.textContent || ""));
      })
    ];

    for (const anchor of candidates.filter(isVisible)) {
      const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
      const raw = text.match(/2-year low is\s+([^()]+?)(?=\s+at|\s+and|\s+last|\s+Price|\(|$)/i)?.[1]
        || text.match(/lowest recorded price is\s+([^()]+?)(?=\s+at|\s+and|\s+last|\s+Price|\(|$)/i)?.[1];
      if (!raw) continue;

      const numericPart = raw.match(/[\d\s\u00a0.,]+/)?.[0];
      const amount = numericPart ? parseNumber(numericPart) : NaN;
      if (!Number.isFinite(amount) || amount <= 0) continue;

      let block = anchor;
      while (block.parentElement && !block.parentElement.matches("#game_area_purchase, body, .responsive_page_content")) {
        const parentText = block.parentElement.textContent || "";
        if (!/SteamDB lowest recorded price is/i.test(parentText) && !block.parentElement.querySelector(".steamdb_prices")) break;
        block = block.parentElement;
      }
      return { amount, currency: basePrice?.currency || "", anchor: getPurchaseBlock(block) };
    }
    return null;
  }

  function formatAmount(amount) {
    return new Intl.NumberFormat(document.documentElement.lang || undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);
  }

  function formatPrice({ amount, currency }) {
    return `${formatAmount(amount)}${currency || ""}`;
  }

  function getAppId() { return location.pathname.match(/\/app\/(\d+)/)?.[1] || null; }
  function getAppTitle() {
    return (document.querySelector(".apphub_AppName")?.textContent || document.title.replace(/\s+on Steam.*$/i, "")).replace(/\s+/g, " ").trim();
  }

  function ensureWidget() {
    let widget = document.getElementById(WIDGET_ID);
    if (!widget) { widget = document.createElement("section"); widget.id = WIDGET_ID; widget.className = "svph-widget"; }
    return widget;
  }

  function attachWidget(anchor, widget) {
    const target = getPurchaseBlock(anchor);
    if (target && (widget.previousElementSibling !== target || !widget.isConnected)) {
      target.insertAdjacentElement("afterend", widget);
    }
  }

  function renderStatus(price, message) {
    const widget = ensureWidget();
    const signature = `status|${price?.amount || ""}|${message}`;
    if (signature !== lastSignature) {
      widget.setAttribute("aria-label", "Steam Value Per Hour status");

      const title = document.createElement("div");
      title.className = "svph-title";
      title.textContent = "Price per hour";

      const statusEl = document.createElement("p");
      statusEl.className = "svph-status";
      statusEl.textContent = message;

      widget.replaceChildren(title, statusEl);
      lastSignature = signature;
    }
    attachWidget(price?.anchor, widget);
  }

  function renderTable({ price, recordPrice, metrics, status }) {
    const widget = ensureWidget();
    const recordMode = Boolean(recordPrice);
    const signature = [settings.mode, price.amount, price.currency, recordPrice?.amount || "", recordPrice?.currency || "", ...metrics.flatMap(({ displayLabel, hours }) => [displayLabel, hours]), status || ""].join("|");
    if (signature !== lastSignature) {
      const fragment = document.createDocumentFragment();

      const title = document.createElement("div");
      title.className = "svph-title";
      title.textContent = "Price per hour";
      fragment.appendChild(title);

      if (status) {
        const statusEl = document.createElement("p");
        statusEl.className = "svph-status";
        statusEl.textContent = status;
        fragment.appendChild(statusEl);
      }

      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");

      const thName = document.createElement("th");
      thName.scope = "col";
      thName.textContent = "Name";

      const thHours = document.createElement("th");
      thHours.scope = "col";
      thHours.textContent = "Hours";

      const thCurrent = document.createElement("th");
      thCurrent.scope = "col";
      thCurrent.textContent = `Current (${formatPrice(price)})`;

      headerRow.append(thName, thHours, thCurrent);

      if (recordMode) {
        const thRecord = document.createElement("th");
        thRecord.scope = "col";
        thRecord.textContent = `Record (${formatPrice(recordPrice)})`;
        headerRow.appendChild(thRecord);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      const currency = price.currency ? ` ${price.currency}` : "";

      for (const { displayLabel, hours } of metrics) {
        const tr = document.createElement("tr");

        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = displayLabel;

        const tdHours = document.createElement("td");
        tdHours.textContent = `${formatAmount(hours)} h`;

        const tdCurrent = document.createElement("td");
        tdCurrent.textContent = `${formatAmount(price.amount / hours)}${currency}/h`;

        tr.append(th, tdHours, tdCurrent);

        if (recordMode) {
          const tdRecord = document.createElement("td");
          tdRecord.textContent = `${formatAmount(recordPrice.amount / hours)}${currency}/h`;
          tr.appendChild(tdRecord);
        }

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      fragment.appendChild(table);

      widget.setAttribute("aria-label", recordMode ? "Price per hour with SteamDB two-year low" : "Price per hour based on HowLongToBeat estimates");
      widget.replaceChildren(fragment);
      lastSignature = signature;
    }
    attachWidget(price.anchor, widget);
  }

  function render() {
    const price = getPrice();
    if (!price) { document.getElementById(WIDGET_ID)?.remove(); lastSignature = null; return false; }
    if (hltbData?.ok && hltbData.metrics?.length) {
      const activeMetrics = hltbData.metrics.filter(
        ({ displayLabel }) => settings.visibleMetrics?.[displayLabel] !== false
      );
      if (!activeMetrics.length) {
        renderStatus(price, "All metrics are hidden in extension settings.");
        return true;
      }
      const recordPrice = settings.mode === "advanced" ? getSteamDbPrice(price) : null;
      renderTable({ price, recordPrice, metrics: activeMetrics });
      return true;
    }
    const message = hltbData?.reason === "no-id-match"
      ? "No HowLongToBeat result with a confirmed Steam AppID match was found."
      : hltbData?.reason === "network"
        ? "HowLongToBeat could not be reached. Try again later."
        : "Loading HowLongToBeat data…";
    renderStatus(price, message);
    return false;
  }

  async function loadSettings() {
    if (!api?.storage?.local) return;
    try {
      const stored = await api.storage.local.get({ mode: DEFAULT_MODE, visibleMetrics: DEFAULT_VISIBLE_METRICS });
      settings.mode = stored.mode === "advanced" ? "advanced" : DEFAULT_MODE;
      settings.visibleMetrics = stored.visibleMetrics || DEFAULT_VISIBLE_METRICS;
    } catch {
      settings.mode = DEFAULT_MODE;
      settings.visibleMetrics = DEFAULT_VISIBLE_METRICS;
    }
  }

  async function requestHltb() {
    if (!api?.runtime?.sendMessage) return;
    const appId = getAppId();
    const title = getAppTitle();
    if (!appId || !title) return;
    const key = `${appId}|${title}`;
    if (hltbRequestKey === key) return;
    hltbRequestKey = key;
    try { hltbData = await api.runtime.sendMessage({ type: "get-hltb", appId, title }); }
    catch { hltbData = { ok: false, reason: "network" }; }
    scheduleRender();
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      scheduled = false;
      if (render() && (settings.mode !== "advanced" || Boolean(getSteamDbPrice()))) stopObservingSoon();
    }, 180);
  }

  function stopObservingSoon() {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => observer?.disconnect(), 1000);
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      const widget = document.getElementById(WIDGET_ID);
      if (mutations.some((mutation) => !widget || (mutation.target !== widget && !widget.contains(mutation.target)))) {
        scheduleRender();
      }
    });
    const target = settings.mode === "advanced" ? document.body : (document.querySelector("#game_area_purchase") || document.body);
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    setTimeout(() => observer?.disconnect(), 15000);
  }

  async function initialize() {
    await loadSettings();
    if (api?.storage?.onChanged) api.storage.onChanged.addListener((changes) => {
      let shouldRerender = false;
      if (changes.mode) {
        settings.mode = changes.mode.newValue === "advanced" ? "advanced" : DEFAULT_MODE;
        observer?.disconnect();
        startObserver();
        shouldRerender = true;
      }
      if (changes.visibleMetrics) {
        settings.visibleMetrics = changes.visibleMetrics.newValue || DEFAULT_VISIBLE_METRICS;
        shouldRerender = true;
      }
      if (shouldRerender) {
        lastSignature = null;
        scheduleRender();
      }
    });
    render();
    startObserver();
    await requestHltb();
    scheduleRender();
  }

  initialize();
})();
