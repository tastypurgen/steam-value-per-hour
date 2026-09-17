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

  loadSettings();
})();
