(() => {
  const WIDGET_ID = "svph-widget";
  const PRICE_SELECTORS = [
    "#game_area_purchase .game_purchase_action .discount_final_price",
    "#game_area_purchase .game_purchase_action .game_purchase_price",
    ".game_area_purchase_game_wrapper .discount_final_price",
    ".game_area_purchase_game_wrapper .game_purchase_price"
  ];

  const isVisible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0;

  function parseNumber(value) {
    const compact = value.replace(/[\s\u00a0]/g, "");
    const lastComma = compact.lastIndexOf(",");
    const lastDot = compact.lastIndexOf(".");
    const decimalIndex = Math.max(lastComma, lastDot);
    const normalized = decimalIndex === -1
      ? compact.replace(/[^\d]/g, "")
      : `${compact.slice(0, decimalIndex).replace(/[^\d]/g, "")}.${compact.slice(decimalIndex + 1).replace(/[^\d]/g, "")}`;
    return Number(normalized);
  }

  function getPrice() {
    const appName = (document.querySelector(".apphub_AppName")?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const baseGameSection = [...document.querySelectorAll("#game_area_purchase .game_area_purchase_game")].find((section) => {
      const heading = (section.querySelector("h2.title")?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return appName && heading.endsWith(appName);
    });

    if (baseGameSection) {
      const priceElement = [...baseGameSection.querySelectorAll(".discount_final_price, .game_purchase_price")].find(isVisible);
      const label = priceElement?.textContent?.trim();
      const numericPart = label?.match(/[\d\s\u00a0.,]+/)?.[0];
      const amount = numericPart ? parseNumber(numericPart) : NaN;
      if (Number.isFinite(amount) && amount > 0) {
        return {
          amount,
          currency: label.replace(numericPart, "").trim(),
          anchor: baseGameSection
        };
      }
    }

    for (const selector of PRICE_SELECTORS) {
      const element = [...document.querySelectorAll(selector)].find(isVisible);
      if (!element) continue;

      const label = element.textContent.trim();
      if (!label || /free to play|бесплатно/i.test(label)) continue;
      const numericPart = label.match(/[\d\s\u00a0.,]+/)?.[0];
      if (!numericPart) continue;
      const amount = parseNumber(numericPart);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const currency = label.replace(numericPart, "").trim();
      return { amount, currency, anchor: element.closest(".game_purchase_action") || element };
    }
    return null;
  }

  function getSteamDbBlock(element) {
    let block = element;
    while (block.parentElement && !block.parentElement.matches("#game_area_purchase, body, .responsive_page_content")) {
      const parentText = block.parentElement.textContent || "";
      if (!/SteamDB lowest recorded price is/i.test(parentText)) break;
      block = block.parentElement;
    }
    return block;
  }

  function getSteamDbPrice() {
    const candidates = [...document.querySelectorAll("*")].filter((element) => {
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      return /SteamDB lowest recorded price is/i.test(text)
        && ![...element.children].some((child) => /SteamDB lowest recorded price is/i.test(child.textContent || ""));
    });
    for (const anchor of candidates.filter(isVisible)) {
      const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
      const twoYearLow = text.match(/2-year low is\s+(.+?)(?=\s+(?:Price seen|last on)|$)/i)?.[1];
      const recordedLow = text.match(/SteamDB lowest recorded price is\s+(.+?)(?=\s+and\s+2-year low is|\s+(?:Price seen|last on)|$)/i)?.[1];
      const label = (twoYearLow || recordedLow)?.replace(/\s+at\s+-?\d+%.*$/i, "").trim();
      if (!label) continue;

      const numericPart = label.match(/[\d\s\u00a0.,]+/)?.[0];
      const amount = numericPart ? parseNumber(numericPart) : NaN;
      if (Number.isFinite(amount) && amount > 0) {
        return { amount, currency: label.replace(numericPart, "").trim(), anchor: getSteamDbBlock(anchor) };
      }
    }
    return null;
  }

  function parseHours(value) {
    const text = value.replace(/½/g, ".5").replace(",", ".");
    const combined = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hours?|ч(?:ас(?:а|ов)?)?\.?)[^\d]*(\d+)\s*(?:m|min|minutes?|м(?:ин)?\.?)/i);
    if (combined) return Number(combined[1]) + Number(combined[2]) / 60;
    const single = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hours?|ч(?:ас(?:а|ов)?)?\.?)/i);
    return single ? Number(single[1]) : null;
  }

  const HLTB_METRICS = [
    {
      sourceLabel: "Main Story",
      displayLabel: "Main Story",
      matches: (text) => /^main story\b(?!\s*(?:and extras|\+ extras))/i.test(text),
      appearsIn: (text) => /\bmain story\b(?!\s*(?:and extras|\+ extras))/i.test(text)
    },
    {
      sourceLabel: "Main Story and Extras",
      displayLabel: "Story and Extras",
      matches: (text) => /^(?:main story and extras|main \+ extras)\b/i.test(text),
      appearsIn: (text) => /\b(?:main story and extras|main \+ extras)\b/i.test(text)
    },
    {
      sourceLabel: "Completionist",
      displayLabel: "Completionist",
      matches: (text) => /^completionist\b/i.test(text),
      appearsIn: (text) => /\bcompletionist\b/i.test(text)
    }
  ];

  function getMetricHours(metric) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const element = walker.currentNode;
      if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      if (!metric.matches(text) || text.length > 80) continue;
      const hours = parseHours(text);
      if (hours && hours > 0) return hours;

      const siblingHours = parseHours(element.nextElementSibling?.textContent || "");
      if (siblingHours && siblingHours > 0) return siblingHours;

      const parentText = (element.parentElement?.textContent || "").replace(/\s+/g, " ").trim();
      const metricLabelsOnParent = HLTB_METRICS.filter(({ appearsIn }) => appearsIn(parentText)).length;
      const parentHours = metricLabelsOnParent === 1 ? parseHours(parentText) : null;
      if (parentHours && parentHours > 0) return parentHours;
    }
    return null;
  }

  function formatAmount(amount) {
    return new Intl.NumberFormat(document.documentElement.lang || undefined, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0
    }).format(amount);
  }

  function formatPrice({ amount, currency }) {
    return `${formatAmount(amount)}${currency || ""}`;
  }

  let lastSignature = null;

  function render() {
    const price = getPrice();
    const steamDbPrice = getSteamDbPrice();
    const metrics = HLTB_METRICS.map((metric) => ({ ...metric, hours: getMetricHours(metric) })).filter(({ hours }) => hours);
    const existing = document.getElementById(WIDGET_ID);

    if (!price || !steamDbPrice || metrics.length === 0) {
      existing?.remove();
      lastSignature = null;
      return false;
    }

    const signature = [
      price.amount,
      price.currency,
      steamDbPrice.amount,
      steamDbPrice.currency,
      ...metrics.flatMap(({ displayLabel, hours }) => [displayLabel, hours])
    ].join("|");
    const rows = metrics.map(({ displayLabel, hours }) => {
      const currentCurrency = price.currency ? ` ${price.currency}` : "";
      const recordCurrency = steamDbPrice.currency ? ` ${steamDbPrice.currency}` : "";
      const currentCost = `${formatAmount(price.amount / hours)}${currentCurrency}/h`;
      const recordCost = `${formatAmount(steamDbPrice.amount / hours)}${recordCurrency}/h`;
      return `<tr><th scope="row">${displayLabel}</th><td>${formatAmount(hours)} h</td><td>${currentCost}</td><td>${recordCost}</td></tr>`;
    }).join("");

    const widget = existing || document.createElement("section");
    widget.id = WIDGET_ID;
    widget.className = "svph-widget";
    widget.setAttribute("aria-label", "Price per hour, based on HowLongToBeat estimates and SteamDB prices");
    if (signature !== lastSignature || !existing) {
      widget.innerHTML = `<div class="svph-title">Price per hour</div><table><thead><tr><th scope="col">Name</th><th scope="col">Hours</th><th scope="col">Current (${formatPrice(price)})</th><th scope="col">Record (${formatPrice(steamDbPrice)})</th></tr></thead><tbody>${rows}</tbody></table>`;
      lastSignature = signature;
    }

    if (!existing) steamDbPrice.anchor.insertAdjacentElement("afterend", widget);
    return true;
  }

  let scheduled = false;
  let stopTimer;
  let observer;

  function stopObservingSoon() {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => observer?.disconnect(), 1000);
  }

  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (render()) stopObservingSoon();
    });
  }

  observer = new MutationObserver((mutations) => {
    const widget = document.getElementById(WIDGET_ID);
    const hasExternalChange = mutations.some((mutation) => !widget || (mutation.target !== widget && !widget.contains(mutation.target)));
    if (hasExternalChange) {
      clearTimeout(stopTimer);
      scheduleRender();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);
  scheduleRender();
})();
