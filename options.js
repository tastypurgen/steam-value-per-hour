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

  form.addEventListener("change", async (event) => {
    if (event.target.name === "mode") {
      if (!api?.storage?.local) {
        showStatus("Could not save settings.");
        return;
      }
      try {
        await api.storage.local.set({ mode: event.target.value === "advanced" ? "advanced" : DEFAULT_MODE });
      } catch {
        showStatus("Could not save settings.");
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
      if (!api?.storage?.local) {
        showStatus("Could not save settings.");
        return;
      }
      try {
        await api.storage.local.set({ visibleMetrics });
      } catch {
        showStatus("Could not save settings.");
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

  load();
})();
