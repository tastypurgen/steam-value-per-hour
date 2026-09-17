(() => {
  const WIDGET_ID = "svph-widget";
  const DEFAULT_MODE = "standalone";
  const PRICE_SELECTORS = [
    "#game_area_purchase .game_purchase_action .discount_final_price",
    "#game_area_purchase .game_purchase_action .game_purchase_price",
    ".game_area_purchase_game_wrapper .discount_final_price",
    ".game_area_purchase_game_wrapper .game_purchase_price"
  ];
  const HLTB_METRICS = [
    {
      displayLabel: "Main Story",
      matches: (text) => /^(?:main story|main|история|основна історія|hauptgeschichte|histoire principale|historia principal|główny wątek)\b(?!\s*(?:and extras|\+ extras|и другое|та інше|und extras|y extras|et extras|i dodatki))/i.test(text),
      appearsIn: (text) => /\b(?:main story|основна історія|история|hauptgeschichte|histoire principale|historia principal|główny wątek)\b(?!\s*(?:and extras|\+ extras|и другое|та інше|und extras|y extras|et extras|i dodatki))/i.test(text)
    },
    {
      displayLabel: "Story and Extras",
      matches: (text) => /^(?:main story and extras|main \+ extras|story and extras|история и другое|історія та інше|hauptgeschichte und extras|histoire principale et extras|historia y extras|główny wątek i dodatki)\b/i.test(text),
      appearsIn: (text) => /\b(?:main story and extras|main \+ extras|story and extras|история и другое|історія та інше|hauptgeschichte und extras|histoire principale et extras|historia y extras|główny wątek i dodatki)\b/i.test(text)
    },
    {
      displayLabel: "Completionist",
      matches: (text) => /^(?:completionist|на 100%|100%|vervollständiger|completista|perfectionniste|kompletne ukończenie)\b/i.test(text),
      appearsIn: (text) => /\b(?:completionist|на 100%|100%|vervollständiger|completista|perfectionniste|kompletne ukończenie)\b/i.test(text)
    }
  ];
  const api = globalThis.browser || globalThis.chrome || null;
  let settings = { mode: DEFAULT_MODE };
  let standaloneData = null;
  let standaloneRequestKey = null;
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

  function getPrice() {
    const appName = (document.querySelector(".apphub_AppName")?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const baseGameSection = [...document.querySelectorAll("#game_area_purchase .game_area_purchase_game")].find((section) => {
      const heading = (section.querySelector("h2.title, h1, h2")?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return appName && (heading.endsWith(appName) || heading.includes(appName));
    });
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

  function getSteamDbPrice() {
    const priceElements = [...document.querySelectorAll(".steamdb_prices, .steamdb_prices_top")];
    const textCandidates = [...document.querySelectorAll("*")].filter((element) => {
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      return /SteamDB lowest recorded price is/i.test(text) && ![...element.children].some((child) => /SteamDB lowest recorded price is/i.test(child.textContent || ""));
    });
    const candidates = [...new Set([...priceElements, ...textCandidates])];

    for (const anchor of candidates.filter(isVisible)) {
      const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
      const twoYearLow = text.match(/2-year low is\s+(.+?)(?=\s+(?:Price seen|last on)|$)/i)?.[1];
      const recordedLow = text.match(/SteamDB lowest recorded price is\s+(.+?)(?=\s+and\s+2-year low is|\s+(?:Price seen|last on)|$)/i)?.[1];
      const label = (twoYearLow || recordedLow)?.replace(/\s+at\s+-?\d+%.*$/i, "").trim();
      if (!label) continue;

      const numericPart = label.match(/[\d\s\u00a0.,]+/)?.[0];
      const amount = numericPart ? parseNumber(numericPart) : NaN;
      if (!Number.isFinite(amount) || amount <= 0) continue;

      let block = anchor;
      while (block.parentElement && !block.parentElement.matches("#game_area_purchase, body, .responsive_page_content")) {
        const parentText = block.parentElement.textContent || "";
        if (!/SteamDB lowest recorded price is/i.test(parentText) && !block.parentElement.querySelector(".steamdb_prices")) break;
        block = block.parentElement;
      }
      return { amount, currency: label.replace(numericPart, "").trim(), anchor: getPurchaseBlock(block) };
    }
    return null;
  }

  function parseHours(value) {
    if (!value) return null;
    const text = value.replace(/½/g, ".5").replace(",", ".");
    const combined = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hours?|ч(?:ас(?:а|ов)?)?|год(?:ин[а-я]*)?|godz\.?|std\.?|ore|horas?|heures?)\D*(\d+)\s*(?:m|min|minutes?|м(?:ин)?|хв(?:ил[а-я]*)?)/i);
    if (combined) return Number(combined[1]) + Number(combined[2]) / 60;
    const single = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hours?|ч(?:ас(?:а|ов)?)?|год(?:ин[а-я]*)?|godz\.?|std\.?|ore|horas?|heures?)/i);
    if (single) return Number(single[1]);
    const fallback = text.match(/(\d+(?:\.\d+)?)/);
    return fallback ? Number(fallback[1]) : null;
  }

  function getDomMetrics() {
    const found = new Map();

    // 1. Direct inspection of Augmented Steam container (.es_hltb)
    const esHltb = document.querySelector(".es_hltb");
    if (esHltb && isVisible(esHltb)) {
      const rows = [...esHltb.querySelectorAll(".details_block b")];
      rows.forEach((bEl, index) => {
        const labelText = (bEl.textContent || "").toLowerCase().replace(/[:\s]+/g, " ").trim();
        const valueText = bEl.nextElementSibling?.tagName === "SPAN"
          ? (bEl.nextElementSibling.textContent || "")
          : (bEl.nextSibling?.textContent || "");
        const hours = parseHours(valueText);
        if (!hours || hours <= 0) return;

        let displayLabel;
        if (/extra|другое|інше|zusatz|dodatk|\+|омаке|支线/i.test(labelText)) {
          displayLabel = "Story and Extras";
        } else if (/compl|100|complet|perfection|vollst|ukoń|완벽|完美/i.test(labelText)) {
          displayLabel = "Completionist";
        } else if (/main|история|історія|haupt|story|wątek|storia|histoire|historia/i.test(labelText)) {
          displayLabel = "Main Story";
        } else if (index === 0) {
          displayLabel = "Main Story";
        } else if (index === 1) {
          displayLabel = "Story and Extras";
        } else if (index === 2) {
          displayLabel = "Completionist";
        }

        if (displayLabel && !found.has(displayLabel)) {
          found.set(displayLabel, { displayLabel, hours });
        }
      });

      if (found.size > 0) {
        return HLTB_METRICS.map((metric) => found.get(metric.displayLabel)).filter(Boolean);
      }
    }

    // 2. Generic TreeWalker fallback across the DOM
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const element = walker.currentNode;
      if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length > 80) continue;
      for (const metric of HLTB_METRICS) {
        if (found.has(metric.displayLabel) || !metric.matches(text)) continue;
        const hours = parseHours(text) || parseHours(element.nextElementSibling?.textContent || "");
        if (hours && hours > 0) { found.set(metric.displayLabel, { ...metric, hours }); continue; }
        const parentText = (element.parentElement?.textContent || "").replace(/\s+/g, " ").trim();
        const labelsOnParent = HLTB_METRICS.filter(({ appearsIn }) => appearsIn(parentText)).length;
        const parentHours = labelsOnParent === 1 ? parseHours(parentText) : null;
        if (parentHours && parentHours > 0) found.set(metric.displayLabel, { ...metric, hours: parentHours });
      }
    }
    return HLTB_METRICS.map((metric) => found.get(metric.displayLabel)).filter(Boolean);
  }

  function formatAmount(amount) {
    return new Intl.NumberFormat(document.documentElement.lang || undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);
  }

  function formatPrice({ amount, currency }) { return `${formatAmount(amount)}${currency || ""}`; }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
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
      widget.innerHTML = `<div class="svph-title">Price per hour</div><p class="svph-status">${escapeHtml(message)}</p>`;
      lastSignature = signature;
    }
    attachWidget(price?.anchor, widget);
  }

  function renderTable({ price, recordPrice, metrics, status }) {
    const widget = ensureWidget();
    const recordMode = Boolean(recordPrice);
    const signature = [settings.mode, price.amount, price.currency, recordPrice?.amount || "", recordPrice?.currency || "", ...metrics.flatMap(({ displayLabel, hours }) => [displayLabel, hours]), status || ""].join("|");
    if (signature !== lastSignature) {
      const currentCurrency = price.currency ? ` ${price.currency}` : "";
      const rows = metrics.map(({ displayLabel, hours }) => {
        const currentCost = `${formatAmount(price.amount / hours)}${currentCurrency}/h`;
        const recordCost = recordPrice ? `${formatAmount(recordPrice.amount / hours)}${recordPrice.currency ? ` ${recordPrice.currency}` : ""}/h` : "";
        return `<tr><th scope="row">${escapeHtml(displayLabel)}</th><td>${formatAmount(hours)} h</td><td>${currentCost}</td>${recordMode ? `<td>${recordCost}</td>` : ""}</tr>`;
      }).join("");
      const recordHeader = recordMode ? `<th scope="col">Record (${escapeHtml(formatPrice(recordPrice))})</th>` : "";
      widget.setAttribute("aria-label", recordMode ? "Price per hour with SteamDB two-year low" : "Price per hour based on HowLongToBeat estimates");
      widget.innerHTML = `<div class="svph-title">Price per hour</div>${status ? `<p class="svph-status">${escapeHtml(status)}</p>` : ""}<table><thead><tr><th scope="col">Name</th><th scope="col">Hours</th><th scope="col">Current (${escapeHtml(formatPrice(price))})</th>${recordHeader}</tr></thead><tbody>${rows}</tbody></table>`;
      lastSignature = signature;
    }
    const anchor = recordPrice?.anchor || price.anchor;
    attachWidget(anchor, widget);
  }

  function render() {
    const price = getPrice();
    if (!price) { document.getElementById(WIDGET_ID)?.remove(); lastSignature = null; return false; }
    if (settings.mode === "advanced") {
      const recordPrice = getSteamDbPrice();
      const metrics = getDomMetrics();
      if (metrics.length) {
        renderTable({ price, recordPrice, metrics });
        return true;
      }
      renderStatus(price, "Waiting for HowLongToBeat data from Augmented Steam.");
      return false;
    }
    if (standaloneData?.ok && standaloneData.metrics?.length) {
      renderTable({ price, metrics: standaloneData.metrics });
      return true;
    }
    const message = standaloneData?.reason === "no-id-match"
      ? "No HowLongToBeat result with a confirmed Steam AppID match was found."
      : standaloneData?.reason === "network"
        ? "HowLongToBeat could not be reached. Try again later."
        : "Loading independent HowLongToBeat data…";
    renderStatus(price, message);
    return false;
  }

  async function loadSettings() {
    if (!api?.storage?.local) return;
    try {
      const stored = await api.storage.local.get({ mode: DEFAULT_MODE });
      settings.mode = stored.mode === "advanced" ? "advanced" : DEFAULT_MODE;
    } catch { settings.mode = DEFAULT_MODE; }
  }

  async function requestStandaloneHltb() {
    if (settings.mode !== DEFAULT_MODE || !api?.runtime?.sendMessage) return;
    const appId = getAppId();
    const title = getAppTitle();
    if (!appId || !title) return;
    const key = `${appId}|${title}`;
    if (standaloneRequestKey === key) return;
    standaloneRequestKey = key;
    try { standaloneData = await api.runtime.sendMessage({ type: "get-hltb", appId, title }); }
    catch { standaloneData = { ok: false, reason: "network" }; }
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
        if (render() && (settings.mode !== "advanced" || Boolean(getSteamDbPrice()))) stopObservingSoon();
      }
    });
    const target = settings.mode === "advanced" ? document.body : (document.querySelector("#game_area_purchase") || document.body);
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    setTimeout(() => observer?.disconnect(), 15000);
  }

  async function initialize() {
    await loadSettings();
    if (api?.storage?.onChanged) api.storage.onChanged.addListener((changes) => {
      if (!changes.mode) return;
      settings.mode = changes.mode.newValue === "advanced" ? "advanced" : DEFAULT_MODE;
      standaloneData = null; standaloneRequestKey = null; lastSignature = null;
      observer?.disconnect();
      startObserver();
      scheduleRender(); requestStandaloneHltb();
    });
    render();
    startObserver();
    await requestStandaloneHltb();
    scheduleRender();
  }

  initialize();
})();
