// Percent fields are shown as 0–100 in the form and stored as 0–1.
const PERCENT_FIELDS: (keyof EstimatorSettings)[] = ["realizedPriceRatio", "refundRate", "taxRate"];
const ALL_FIELDS = Object.keys(DEFAULT_SETTINGS) as (keyof EstimatorSettings)[];

let currentSettings: EstimatorSettings = { ...DEFAULT_SETTINGS };


async function _init(): Promise<void> {
    currentSettings = await loadSettings();
    _fillForm(currentSettings);
    document.getElementById("save")!.addEventListener("click", _save);
    document.getElementById("reset")!.addEventListener("click", _reset);
    document.getElementById("backup")!.addEventListener("click", _backup);
    const restoreInput = document.getElementById("restore-file") as HTMLInputElement;
    document.getElementById("restore")!.addEventListener("click", () => restoreInput.click());
    restoreInput.addEventListener("change", async () => {
        const file = restoreInput.files?.[0];
        restoreInput.value = "";
        if (file !== undefined) {
            await _restore(file);
        }
    });

    document.getElementById("clear-all")!.addEventListener("click", _clearAll);
    const shareButton = document.getElementById("share-page")!;
    if (isSharedCopy()) {
        // A shared copy can't rebuild itself from extension files, and the "track on Steam" intro doesn't apply.
        shareButton.hidden = true;
        document.querySelector(".page-header p")!.textContent = "A snapshot of tracked Steam games with estimated revenue. Change the settings at the bottom to recalculate everything.";
    } else {
        shareButton.addEventListener("click", _downloadShareablePage);
    }

    initDashboardControls();
    await renderDashboard(currentSettings);

    // Tracking or removing a game in a Steam tab updates this page live.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && TRACKED_KEY in changes) {
            renderDashboard(currentSettings);
        }
    });
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(renderCharts, 150);
    });
}


function _fillForm(settings: EstimatorSettings): void {
    for (const field of ALL_FIELDS) {
        const value = PERCENT_FIELDS.includes(field) ? settings[field] * 100 : settings[field];
        _input(field).value = String(Math.round(value * 100) / 100);
    }
}


async function _save(): Promise<void> {
    const settings = { ...DEFAULT_SETTINGS };
    for (const field of ALL_FIELDS) {
        const raw = Number(_input(field).value);
        if (!Number.isFinite(raw) || raw < 0) {
            _setStatus(`Invalid value for ${field}.`);
            return;
        }
        settings[field] = PERCENT_FIELDS.includes(field) ? raw / 100 : raw;
    }
    if (settings.reviewMultiplierLow > settings.reviewMultiplierHigh) {
        _setStatus("Low multiplier must not exceed the high multiplier.");
        return;
    }
    await chrome.storage.sync.set(settings);
    currentSettings = settings;
    await renderDashboard(currentSettings);
    _setStatus("Saved. Reload open Steam pages to see the change there.");
}


async function _reset(): Promise<void> {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    currentSettings = { ...DEFAULT_SETTINGS };
    _fillForm(currentSettings);
    await renderDashboard(currentSettings);
    _setStatus("Reset to defaults.");
}


async function _backup(): Promise<void> {
    const json = await createBackup();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    link.download = `steam-revenue-estimator-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    const count = Object.keys((await loadTrackedGames())).length;
    _setDataStatus(`Backup downloaded (${count} ${count === 1 ? "game" : "games"} plus your settings).`);
}


async function _restore(file: File): Promise<void> {
    let backup: ParsedBackup;
    try {
        backup = parseBackup(await file.text());
    } catch (error) {
        _setDataStatus(error instanceof Error ? error.message : String(error), true);
        return;
    }

    const count = Object.keys(backup.trackedGames).length;
    let message = `Restore ${count} ${count === 1 ? "game" : "games"} from this backup?\n\n`
        + "They'll be merged into your current list; nothing you already track is removed.";
    if (backup.settings !== null) {
        message += "\n\nYour estimate settings will also be replaced with the ones in the backup.";
    }
    if (!window.confirm(message)) {
        return;
    }

    const changed = await mergeTrackedGames(backup.trackedGames);
    if (backup.settings !== null) {
        await chrome.storage.sync.set(backup.settings);
        currentSettings = backup.settings;
        _fillForm(currentSettings);
    }
    await renderDashboard(currentSettings);

    let status = `Restored: ${changed} ${changed === 1 ? "game" : "games"} added or updated`;
    if (count - changed > 0) {
        status += `, ${count - changed} already up to date`;
    }
    if (backup.skipped > 0) {
        status += `, ${backup.skipped} unreadable ${backup.skipped === 1 ? "entry" : "entries"} skipped`;
    }
    _setDataStatus(`${status}.`);
}


async function _downloadShareablePage(): Promise<void> {
    const count = Object.keys(await loadTrackedGames()).length;
    if (count === 0) {
        _setDataStatus("Track some games first; the shareable page is a snapshot of your current list.");
        return;
    }
    const html = await createShareablePage();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    link.download = `steam-revenue-dashboard-${new Date().toISOString().slice(0, 10)}.html`;
    link.click();
    URL.revokeObjectURL(link.href);
    _setDataStatus(`Shareable page downloaded (${count} ${count === 1 ? "game" : "games"}). It opens in any browser, no extension needed.`);
}


async function _clearAll(): Promise<void> {
    const count = Object.keys(await loadTrackedGames()).length;
    if (count === 0) {
        _setDataStatus("Your list is already empty.");
        return;
    }
    const message = `Remove all ${count} tracked ${count === 1 ? "game" : "games"}?\n\n`
        + "This can't be undone. Download a backup first if you might want them back. Your settings are kept.";
    if (!window.confirm(message)) {
        return;
    }
    await clearTrackedGames();
    await renderDashboard(currentSettings);
    _setDataStatus(`Cleared ${count} ${count === 1 ? "game" : "games"}.`);
}


function _input(field: keyof EstimatorSettings): HTMLInputElement {
    return document.getElementById(field) as HTMLInputElement;
}


function _setStatus(text: string): void {
    document.getElementById("status")!.textContent = text;
}


function _setDataStatus(text: string, isError = false): void {
    const status = document.getElementById("data-status")!;
    status.textContent = text;
    status.classList.toggle("error", isError);
}


_init();
