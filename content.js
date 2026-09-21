(() => {
  const WIDGET_ID = "svph-widget";
  const DEFAULT_MODE = "standalone";
  const DEFAULT_VISIBLE_METRICS = {
    "All PlayStyles": true,
    "Main Story": true,
    "Story and Extras": true,
    "Completionist": true
  };
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
    const compact = String(value || "").replace(/[\s\u00a0]/g, "");
    const separators = [...compact.matchAll(/[.,]/g)].map((match) => match.index);
    if (!separators.length) return Number(compact.replace(/[^\d]/g, ""));

    const lastSeparator = separators[separators.length - 1];
    const fractionalDigits = compact.slice(lastSeparator + 1).replace(/[^\d]/g, "");
    const hasBothSeparators = compact.includes(",") && compact.includes(".");
    const isThousandsSeparated = !hasBothSeparators && fractionalDigits.length === 3;
    if (isThousandsSeparated) return Number(compact.replace(/[.,]/g, "").replace(/[^\d]/g, ""));

    const integerPart = compact.slice(0, lastSeparator).replace(/[.,]/g, "").replace(/[^\d]/g, "");
    return Number(`${integerPart || "0"}.${fractionalDigits}`);
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

  function isBundleBlock(element) {
    if (!element) return false;
    return Boolean(
      element.matches?.("[data-ds-bundleid], .dynamic_bundle_description") ||
      element.closest?.("[data-ds-bundleid], .dynamic_bundle_description") ||
      element.querySelector?.("input[name='bundleid'], form[name^='add_bundle_to_cart'], .bundle_label, .btn_packageinfo") ||
      /\bbundle\b/i.test(element.querySelector?.("h2.title, h1, h2")?.textContent || "")
    );
  }

  function isSubscriptionBlock(element) {
    if (!element) return false;
    return Boolean(
      element.matches?.(".game_area_purchase_game_dropdown_subscription") ||
      element.closest?.(".game_area_purchase_game_dropdown_subscription") ||
      element.querySelector?.(".game_area_purchase_game_dropdown_selection") ||
      /join\s+(?:ea\s+play|ubisoft\+|gta\+)|подписк|abonnement/i.test(element.textContent || "")
    );
  }

  function isAddonText(text) {
    return /\b(?:soundtrack|ost|dlc|artbook|season\s+pass|expansion(?:\s+pass)?|upgrade(?:\s+pack)?|content\s+pack|bundle|саундтрек|дополнение|сезонный\s+пропуск|сезонний\s+пропуск)\b/i.test(text);
  }

  function scorePurchaseBlock(heading, appName, baseAppName, index = 0) {
    const normHeading = normalizeTitle(heading);
    if (!normHeading) return -100;
    if (isAddonText(normHeading)) return -100;

    const names = [appName, baseAppName].filter((n) => n && n.length >= 3);
    let titleScore = 0;
    for (const name of names) {
      if (normHeading.includes(name)) {
        titleScore = Math.max(titleScore, 60);
      }
    }

    if (!titleScore && names.length) {
      const titleTokens = names[0].split(/\s+/).filter((w) => w.length > 2);
      if (titleTokens.length) {
        const matchCount = titleTokens.filter((t) => normHeading.includes(t)).length;
        if (matchCount === titleTokens.length) titleScore = 50;
        else if (matchCount / titleTokens.length >= 0.6) titleScore = 30;
      }
    }

    if (!titleScore) return -100;

    let editionScore = 0;
    const hasEditionWord = /\b(?:edition|deluxe|complete|gold|ultimate|premium|enhanced|definitive|remastered|goty|game of the year|director s cut|vr|издание)\b/i.test(normHeading);
    const isStandard = /\b(?:standard|базовое)\b/i.test(normHeading);

    if (!hasEditionWord) {
      editionScore = 40;
    } else if (isStandard) {
      editionScore = 35;
    } else {
      editionScore = 15;
    }

    const positionScore = Math.max(0, 10 - index * 3);

    return titleScore + editionScore + positionScore;
  }

  function isBaseGameHeading(heading, appName, baseAppName) {
    return scorePurchaseBlock(heading, appName, baseAppName, 0) >= 60;
  }

  function machinePriceFrom(element, section) {
    const nodes = [];
    let current = element;
    while (current && nodes.length < 5) {
      nodes.push(current);
      if (current === section) break;
      current = current.parentElement;
    }
    const machineNode = nodes.find((node) => node.hasAttribute?.("data-price-final") || node.hasAttribute?.("data-price"));
    if (!machineNode) return null;
    const raw = machineNode.getAttribute("data-price-final") || machineNode.getAttribute("data-price");
    const minorUnits = Number(raw);
    if (!Number.isFinite(minorUnits) || minorUnits <= 0) return null;
    return {
      amount: minorUnits / 100,
      currency: machineNode.getAttribute("data-currency") || machineNode.getAttribute("data-currency-code") || ""
    };
  }

  function priceFromElement(element, section) {
    const label = element?.textContent?.trim() || "";
    if (!label || /free to play|бесплатно/i.test(label)) return null;
    const machinePrice = machinePriceFrom(element, section);
    if (machinePrice) {
      const numericLabel = label.match(/[\d\s\u00a0.,]+/)?.[0];
      return { ...machinePrice, currency: numericLabel ? label.replace(numericLabel, "").trim() : machinePrice.currency };
    }
    const numericPart = label.match(/[\d\s\u00a0.,]+/)?.[0];
    if (!numericPart) return null;
    const amount = parseNumber(numericPart);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { amount, currency: label.replace(numericPart, "").trim() };
  }

  function getPrice() {
    const rawAppName = document.querySelector(".apphub_AppName")?.textContent || getAppTitle();
    const appName = normalizeTitle(rawAppName);
    const baseAppName = stripEdition(appName);
    const scope = document.getElementById("game_area_purchase") || document.body;
    const purchaseSections = [...scope.querySelectorAll(".game_area_purchase_game")];

    // Filter out bundles and subscriptions
    const nonBundleSections = purchaseSections.filter((section) => !isBundleBlock(section) && !isSubscriptionBlock(section));
    const candidateSections = nonBundleSections.length ? nonBundleSections : purchaseSections;

    // Score candidates that have a visible price
    const scoredCandidates = candidateSections.map((section, index) => {
      const heading = section.querySelector("h2.title, h1, h2")?.textContent || "";
      const priceElement = [...section.querySelectorAll(".discount_final_price, .game_purchase_price")].find(isVisible);
      const price = priceElement && priceFromElement(priceElement, section);
      const score = scorePurchaseBlock(heading, appName, baseAppName, index);
      return { section, heading, price, score };
    }).filter((c) => c.price && c.score > 0);

    if (scoredCandidates.length) {
      scoredCandidates.sort((a, b) => b.score - a.score);
      const best = scoredCandidates[0];
      return { ...best.price, anchor: getPurchaseBlock(best.section) };
    }

    // Fallback: if exactly one candidate section has a valid price and is not an addon
    const validFallbacks = candidateSections.map((section) => {
      const heading = section.querySelector("h2.title, h1, h2")?.textContent || "";
      if (isAddonText(normalizeTitle(heading))) return null;
      const priceElement = [...section.querySelectorAll(".discount_final_price, .game_purchase_price")].find(isVisible);
      const price = priceElement && priceFromElement(priceElement, section);
      return price ? { section, price } : null;
    }).filter(Boolean);

    if (validFallbacks.length === 1) {
      return { ...validFallbacks[0].price, anchor: getPurchaseBlock(validFallbacks[0].section) };
    }

    return null;
  }

  function getSteamDbPrice(basePrice = null) {
    let candidates = [...document.querySelectorAll(".steamdb_prices, .steamdb_prices_top")];
    if (!candidates.length) {
      const scope = document.getElementById("game_area_purchase")
        || document.querySelector(".game_area_purchase_game_wrapper")
        || document.body;
      candidates = [...scope.querySelectorAll("div, p, span, td")].filter((el) => {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        return /SteamDB lowest recorded price is/i.test(text) && ![...el.children].some((c) => /SteamDB lowest recorded price is/i.test(c.textContent || ""));
      });
    }

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
    return (document.querySelector(".apphub_AppName")?.textContent || document.title.replace(/^(?:save\s+\d+%\s+on|сэкономьте\s+\d+%\s+(?:при покупке\s+)?|заощадьте\s+\d+%\s+(?:на\s+)?)/i, "").replace(/\s+on Steam.*$/i, "")).replace(/\s+/g, " ").trim();
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

      const children = [title, statusEl];
      if (hltbData?.reason === "service-error") {
        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.className = "svph-retry";
        retryButton.textContent = "Retry";
        retryButton.addEventListener("click", () => {
          hltbRequestKey = null;
          hltbData = null;
          lastSignature = null;
          scheduleRender();
          requestHltb();
        }, { once: true });
        children.push(retryButton);
      } else if (hltbData?.reason === "no-permission") {
        const grantButton = document.createElement("button");
        grantButton.type = "button";
        grantButton.className = "svph-retry";
        grantButton.textContent = "Open settings to grant access";
        grantButton.addEventListener("click", () => {
          api?.runtime?.sendMessage?.({ type: "open-options" })?.catch?.(() => {});
        }, { once: true });
        children.push(grantButton);
      }
      widget.replaceChildren(...children);
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
      : hltbData?.reason === "no-permission"
        ? "Access to HowLongToBeat is not granted in the extension permissions."
        : hltbData?.reason === "service-error"
          ? "HowLongToBeat is temporarily unavailable."
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
    catch { hltbData = { ok: false, reason: "service-error" }; }
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

  const testExports = { parseNumber, isBaseGameHeading, machinePriceFrom, priceFromElement, isBundleBlock, isSubscriptionBlock, scorePurchaseBlock };
  if (typeof module !== "undefined" && module.exports) module.exports = testExports;
  if (typeof document !== "undefined") initialize();
})();
