(() => {
  const api = globalThis.browser || globalThis.chrome;
  const form = document.getElementById("settings-form");
  const status = document.getElementById("save-status");
  const DEFAULT_MODE = "standalone";
  const DEFAULT_VISIBLE_METRICS = {
    "All PlayStyles": true,
    "Main Story": true,
    "Story and Extras": true,
    "Completionist": true
  };

  function showStatus(message) {
    status.textContent = message;
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => { status.textContent = ""; }, 2200);
  }

  function setMetricsSelection(visibleMetrics) {
    const checkboxes = form.elements.metric ? (form.elements.metric.length ? [...form.elements.metric] : [form.elements.metric]) : [];
    for (const cb of checkboxes) {
      cb.checked = !visibleMetrics || visibleMetrics[cb.value] !== false;
    }
  }

  async function load() {
    try {
      if (!api?.storage?.local) return;
      const stored = await api.storage.local.get({ mode: DEFAULT_MODE, visibleMetrics: DEFAULT_VISIBLE_METRICS });
      const mode = stored.mode === "advanced" ? "advanced" : DEFAULT_MODE;
      const input = form.elements.mode && [...form.elements.mode].find((item) => item.value === mode);
      if (input) input.checked = true;
      setMetricsSelection(stored.visibleMetrics);
    } catch {
      showStatus("Could not load settings.");
    }
  }

  const isRussian = (navigator.language || "").toLowerCase().startsWith("ru");

  function localize() {
    if (!isRussian) return;
    const intro = document.querySelector(".intro");
    if (intro) intro.textContent = "Выберите источник данных HowLongToBeat и истории цен.";
    const legend = document.querySelector("legend");
    if (legend) legend.textContent = "Режим данных";

    const standaloneOption = form.querySelector('input[value="standalone"]')?.closest(".mode-option");
    if (standaloneOption) {
      const strong = standaloneOption.querySelector("strong");
      const small = standaloneOption.querySelector("small");
      if (strong) strong.textContent = "Дефолтный / независимый режим (рекомендуется)";
      if (small) small.textContent = "Использует текущую региональную цену Steam и прямой запрос к HowLongToBeat. Работает без сторонних расширений и не показывает колонку рекордных цен.";
    }

    const advancedOption = form.querySelector('input[value="advanced"]')?.closest(".mode-option");
    if (advancedOption) {
      const strong = advancedOption.querySelector("strong");
      const small = advancedOption.querySelector("small");
      if (strong) strong.textContent = "Расширенный режим";
      if (small) small.textContent = "Использует прямой запрос к HowLongToBeat и добавляет колонку рекордной цены по минимуму SteamDB за 2 года.";
    }

    const depsTitle = document.getElementById("dependencies-title");
    if (depsTitle) depsTitle.textContent = "Опциональное расширение для расширенного режима";

    const metricsLegend = document.getElementById("metrics-legend");
    if (metricsLegend) metricsLegend.textContent = "Отображаемые показатели";

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    setText("opt-all-title", "Все стили (All PlayStyles)");
    setText("opt-all-desc", "Общее среднее время прохождения среди всех стилей игры.");
    setText("opt-main-title", "Основной сюжет (Main Story)");
    setText("opt-main-desc", "Время прохождения основного сюжета / сюжетной кампании.");
    setText("opt-plus-title", "Сюжет и дополнения (Story and Extras)");
    setText("opt-plus-desc", "Прохождение основного сюжета вместе с побочными заданиями.");
    setText("opt-100-title", "100% прохождение (Completionist)");
    setText("opt-100-desc", "Полное прохождение игры, всех достижений и секретов.");
  }

  form.addEventListener("change", async (event) => {
    if (event.target.name === "mode") {
      try {
        if (!api?.storage?.local) throw new Error("Storage API not available");
        await api.storage.local.set({ mode: event.target.value === "advanced" ? "advanced" : DEFAULT_MODE });
        showStatus(isRussian ? "Настройки сохранены." : "Settings saved.");
      } catch {
        showStatus(isRussian ? "Не удалось сохранить настройки." : "Could not save settings.");
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
        if (!api?.storage?.local) throw new Error("Storage API not available");
        await api.storage.local.set({ visibleMetrics });
        showStatus(isRussian ? "Настройки сохранены." : "Settings saved.");
      } catch {
        showStatus(isRussian ? "Не удалось сохранить настройки." : "Could not save settings.");
      }
    }
  });

  if (api?.storage?.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        if (changes.mode) {
          const mode = changes.mode.newValue === "advanced" ? "advanced" : DEFAULT_MODE;
          const input = form.elements.mode && [...form.elements.mode].find((item) => item.value === mode);
          if (input) input.checked = true;
        }
        if (changes.visibleMetrics) {
          setMetricsSelection(changes.visibleMetrics.newValue);
        }
      }
    });
  }

  localize();
  load();
})();
