(() => {
  const api = globalThis.browser || globalThis.chrome;
  const form = document.getElementById("settings-form");
  const status = document.getElementById("save-status");
  const DEFAULT_MODE = "standalone";

  function showStatus(message) {
    status.textContent = message;
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => { status.textContent = ""; }, 2200);
  }

  async function load() {
    try {
      const stored = await api.storage.local.get({ mode: DEFAULT_MODE });
      const mode = stored.mode === "advanced" ? "advanced" : DEFAULT_MODE;
      const input = form.elements.mode && [...form.elements.mode].find((item) => item.value === mode);
      if (input) input.checked = true;
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
      if (small) small.textContent = "Считывает блоки HLTB и SteamDB, уже добавленные на страницу расширениями ниже. Колонка рекорда использует минимум SteamDB за 2 года.";
    }

    const depsTitle = document.getElementById("dependencies-title");
    if (depsTitle) depsTitle.textContent = "Необходимые расширения для расширенного режима";
  }

  form.addEventListener("change", async (event) => {
    if (event.target.name !== "mode") return;
    try {
      await api.storage.local.set({ mode: event.target.value === "advanced" ? "advanced" : DEFAULT_MODE });
      showStatus(isRussian ? "Настройки сохранены." : "Settings saved.");
    } catch {
      showStatus(isRussian ? "Не удалось сохранить настройки." : "Could not save settings.");
    }
  });

  if (api?.storage?.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.mode) {
        const mode = changes.mode.newValue === "advanced" ? "advanced" : DEFAULT_MODE;
        const input = form.elements.mode && [...form.elements.mode].find((item) => item.value === mode);
        if (input) input.checked = true;
      }
    });
  }

  localize();
  load();
})();
