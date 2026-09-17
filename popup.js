(() => {
  const api = globalThis.browser || globalThis.chrome;
  const DEFAULT_MODE = "standalone";
  const DEFAULT_VISIBLE_METRICS = {
    "All PlayStyles": true,
    "Main Story": true,
    "Story and Extras": true,
    "Completionist": true
  };

  const form = document.getElementById("mode-form");
  const saveStatus = document.getElementById("save-status");
  const advancedDeps = document.getElementById("advanced-deps");
  const openOptionsLink = document.getElementById("open-options");

  const I18N = {
    en: {
      subtitle: "Price per hour for Steam",
      modeLegend: "Data Mode",
      defaultName: "Default (Independent)",
      defaultBadge: "Recommended",
      defaultDesc: "Direct HowLongToBeat lookup. Works without any other extensions and uses Steam's current regional price.",
      advancedName: "Advanced",
      advancedBadge: "+ SteamDB",
      advancedDesc: "Direct HowLongToBeat lookup plus SteamDB's 2-year low record price.",
      depsTitle: "Requires page extension:",
      depSdbHint: "(for 2-year low)",
      metricsLegend: "Displayed Metrics",
      metricAll: "All PlayStyles",
      metricMain: "Main Story",
      metricPlus: "Story and Extras",
      metric100: "Completionist",
      optionsLink: "Full settings",
      saved: "Settings saved."
    },
    ru: {
      subtitle: "Стоимость часа игры в Steam",
      modeLegend: "Режим работы",
      defaultName: "Дефолтный (независимый)",
      defaultBadge: "Рекомендуется",
      defaultDesc: "Прямой запрос к HowLongToBeat. Работает без сторонних расширений и использует региональную цену Steam.",
      advancedName: "Расширенный",
      advancedBadge: "+ SteamDB",
      advancedDesc: "Прямой запрос к HowLongToBeat плюс колонка рекордно низкой цены за 2 года из блока SteamDB.",
      depsTitle: "Требуется расширение на странице:",
      depSdbHint: "(для минимума за 2 года)",
      metricsLegend: "Отображаемые показатели",
      metricAll: "Все стили (All PlayStyles)",
      metricMain: "Основной сюжет (Main Story)",
      metricPlus: "Сюжет и дополнения (Story and Extras)",
      metric100: "100% прохождение (Completionist)",
      optionsLink: "Все настройки",
      saved: "Настройки сохранены."
    }
  };

  const isRussian = (navigator.language || "").toLowerCase().startsWith("ru");
  const texts = isRussian ? I18N.ru : I18N.en;

  function applyLocalization() {
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText("subtitle-text", texts.subtitle);
    setText("mode-legend", texts.modeLegend);
    setText("mode-default-name", texts.defaultName);
    setText("mode-default-badge", texts.defaultBadge);
    setText("mode-default-desc", texts.defaultDesc);
    setText("mode-advanced-name", texts.advancedName);
    setText("mode-advanced-badge", texts.advancedBadge);
    setText("mode-advanced-desc", texts.advancedDesc);
    setText("deps-title", texts.depsTitle);
    setText("dep-sdb-hint", texts.depSdbHint);
    setText("metrics-legend", texts.metricsLegend);
    setText("metric-label-all", texts.metricAll);
    setText("metric-label-main", texts.metricMain);
    setText("metric-label-plus", texts.metricPlus);
    setText("metric-label-100", texts.metric100);
    setText("options-link-text", texts.optionsLink);
  }

  let statusTimer = null;
  function showStatus(message) {
    saveStatus.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      saveStatus.textContent = "";
    }, 2000);
  }

  function updateDepsVisibility(mode) {
    if (advancedDeps) {
      advancedDeps.hidden = mode !== "advanced";
    }
  }

  function setModeSelection(mode) {
    const target = mode === "advanced" ? "advanced" : DEFAULT_MODE;
    const input = form.elements.mode && [...form.elements.mode].find((item) => item.value === target);
    if (input) input.checked = true;
    updateDepsVisibility(target);
  }

  function setMetricsSelection(visibleMetrics) {
    const checkboxes = form.elements.metric ? (form.elements.metric.length ? [...form.elements.metric] : [form.elements.metric]) : [];
    for (const cb of checkboxes) {
      cb.checked = !visibleMetrics || visibleMetrics[cb.value] !== false;
    }
  }

  async function loadSettings() {
    try {
      const stored = await api.storage.local.get({ mode: DEFAULT_MODE, visibleMetrics: DEFAULT_VISIBLE_METRICS });
      setModeSelection(stored.mode);
      setMetricsSelection(stored.visibleMetrics);
    } catch {
      setModeSelection(DEFAULT_MODE);
      setMetricsSelection(DEFAULT_VISIBLE_METRICS);
    }
  }

  form.addEventListener("change", async (event) => {
    if (event.target.name === "mode") {
      const selectedMode = event.target.value === "advanced" ? "advanced" : DEFAULT_MODE;
      updateDepsVisibility(selectedMode);
      try {
        await api.storage.local.set({ mode: selectedMode });
        showStatus(texts.saved);
      } catch {
        showStatus("Error saving.");
      }
    } else if (event.target.name === "metric") {
      const checkboxes = form.elements.metric ? (form.elements.metric.length ? [...form.elements.metric] : [form.elements.metric]) : [];
      const checkedBoxes = checkboxes.filter((cb) => cb.checked);
      if (checkedBoxes.length === 0) {
        event.target.checked = true;
        return;
      }
      const visibleMetrics = {};
      for (const cb of checkboxes) {
        visibleMetrics[cb.value] = cb.checked;
      }
      try {
        await api.storage.local.set({ visibleMetrics });
        showStatus(texts.saved);
      } catch {
        showStatus("Error saving.");
      }
    }
  });

  if (api?.storage?.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        if (changes.mode) setModeSelection(changes.mode.newValue);
        if (changes.visibleMetrics) setMetricsSelection(changes.visibleMetrics.newValue);
      }
    });
  }

  openOptionsLink?.addEventListener("click", (e) => {
    e.preventDefault();
    if (api?.runtime?.openOptionsPage) {
      api.runtime.openOptionsPage();
    } else {
      window.open("options.html");
    }
  });

  applyLocalization();
  loadSettings();
})();
