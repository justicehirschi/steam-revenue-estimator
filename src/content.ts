const WIDGET_ID = "sre-widget";


async function _run(): Promise<void> {
    const appId = location.pathname.match(/^\/app\/(\d+)/)?.[1];
    if (appId === undefined || document.getElementById(WIDGET_ID) !== null) {
        return;
    }

    const widget = _createWidget();
    if (!_insertWidget(widget)) {
        return;
    }
    const body = widget.querySelector<HTMLElement>(".sre-body")!;
    body.append(makeElement("div", "sre-muted", "Estimating…"));

    try {
        const [game, settings, tracked] = await Promise.all([
            fetchGameData(appId),
            loadSettings(),
            loadTrackedGames(),
        ]);
        const result = estimateRevenue(game, settings);
        body.replaceChildren(...renderEstimate(game, settings, result));

        if (result.kind === "estimate") {
            const isTracked = appId in tracked;
            if (isTracked) {
                // Keep the saved copy fresh whenever a tracked game is revisited.
                await trackGame(game);
            }
            widget.querySelector(".sre-actions")!.prepend(_createTrackButton(game, isTracked));
        }
    } catch (error) {
        console.error("[Steam Revenue Estimator]", error);
        body.replaceChildren(makeElement("div", "sre-muted", "Couldn't load data for this game."));
    }
}


function _createWidget(): HTMLElement {
    const widget = makeElement("div");
    widget.id = WIDGET_ID;

    const header = makeElement("div", "sre-header");
    const actions = makeElement("div", "sre-actions");
    const dashboardLink = makeElement("a", "sre-link", "Dashboard");
    dashboardLink.setAttribute("href", "#");
    dashboardLink.addEventListener("click", (event: Event) => {
        event.preventDefault();
        if (!_isExtensionAlive()) {
            _showReloadNotice(widget);
            return;
        }
        chrome.runtime.sendMessage({ type: "open-options" }).catch(() => _showReloadNotice(widget));
    });
    actions.append(dashboardLink);
    header.append(makeElement("span", "sre-title", "Revenue estimate"), actions);

    widget.append(header, makeElement("div", "sre-body"));
    return widget;
}


function _createTrackButton(game: GameData, initiallyTracked: boolean): HTMLButtonElement {
    const button = makeElement("button", "sre-track") as HTMLButtonElement;
    button.type = "button";
    let tracked = initiallyTracked;

    const update = (): void => {
        button.textContent = tracked ? "✓ Tracked" : "+ Track";
        button.title = tracked ? "Remove from your tracked list" : "Add to your tracked list";
        button.classList.toggle("sre-track-active", tracked);
    };
    update();

    button.addEventListener("click", async () => {
        if (!_isExtensionAlive()) {
            _showReloadNotice(button.closest<HTMLElement>(`#${WIDGET_ID}`)!);
            return;
        }
        button.disabled = true;
        try {
            if (tracked) {
                await untrackGame(game.appId);
            } else {
                await trackGame(game);
            }
            tracked = !tracked;
            update();
        } catch (error) {
            console.error("[Steam Revenue Estimator]", error);
        } finally {
            button.disabled = false;
        }
    });
    return button;
}


// After the extension is reloaded or updated, scripts already running in open tabs lose access
// to chrome.* APIs ("Extension context invalidated") until the page is refreshed.
function _isExtensionAlive(): boolean {
    try {
        return chrome.runtime?.id !== undefined;
    } catch {
        return false;
    }
}


function _showReloadNotice(widget: HTMLElement): void {
    if (widget.querySelector(".sre-notice") !== null) {
        return;
    }
    const notice = makeElement("div", "sre-notice", "The extension was updated. Refresh this page to use it again.");
    widget.querySelector(".sre-header")!.after(notice);
}


function _insertWidget(widget: HTMLElement): boolean {
    const purchaseArea = document.getElementById("game_area_purchase");
    if (purchaseArea !== null) {
        purchaseArea.before(widget);
        return true;
    }
    const highlights = document.getElementById("game_highlights");
    if (highlights !== null) {
        highlights.after(widget);
        return true;
    }
    return false;
}


_run();
