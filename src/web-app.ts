// Web version (web/index.html): looks up a game through the Cloudflare Worker and shows the same estimate
// panel as the extension. Opened as ?url=<Steam link> (from the iOS Shortcut), ?app=<app ID>, or by pasting a link.

// From web/config.js. Empty means the user enters it on the page.
declare const SRE_WORKER_URL: string | undefined;

const WEB_WORKER_KEY = "sre-worker-url";
const WEB_WIDGET_ID = "sre-widget";


function webMain(): void {
    const form = document.getElementById("lookup") as HTMLFormElement;
    const input = document.getElementById("lookup-input") as HTMLInputElement;
    form.addEventListener("submit", (event: Event) => {
        event.preventDefault();
        const appId = parseSteamAppId(input.value);
        if (appId === null) {
            _webShowMessage("That doesn't look like a Steam store link or app ID.");
            return;
        }
        input.value = "";
        input.blur();
        history.replaceState(null, "", `?app=${appId}`);
        _webEstimate(appId);
    });

    _webInitSetup();

    const params = new URLSearchParams(location.search);
    const appId = parseSteamAppId(params.get("app") ?? params.get("url") ?? params.get("q") ?? "");
    if (appId !== null) {
        history.replaceState(null, "", `?app=${appId}`);
        _webEstimate(appId);
    }
}


// Accepts store links (store.steampowered.com/app/123/...), s.team short links (s.team/a/123),
// steam://store/123 links, text with a link somewhere in it, or a bare app ID.
function parseSteamAppId(text: string): string | null {
    const trimmed = text.trim();
    const linked = trimmed.match(/(?:\/app\/|s\.team\/a\/|steam:\/\/(?:store|url\/StoreAppPage)\/)(\d+)/i);
    if (linked !== null) {
        return linked[1];
    }
    const bare = trimmed.match(/^(\d{1,10})$/);
    return bare === null ? null : bare[1];
}


function _webWorkerUrl(): string {
    const fixed = typeof SRE_WORKER_URL === "string" ? SRE_WORKER_URL.trim() : "";
    if (fixed !== "") {
        return fixed.replace(/\/+$/, "");
    }
    try {
        return (localStorage.getItem(WEB_WORKER_KEY) ?? "").trim().replace(/\/+$/, "");
    } catch {
        return "";
    }
}


function _webInitSetup(): void {
    const setup = document.getElementById("setup") as HTMLDetailsElement;
    const setupInput = document.getElementById("worker-url") as HTMLInputElement;
    const fixed = typeof SRE_WORKER_URL === "string" && SRE_WORKER_URL.trim() !== "";
    if (fixed) {
        setup.hidden = true;
        return;
    }
    setupInput.value = _webWorkerUrl();
    setup.open = _webWorkerUrl() === "";
    document.getElementById("setup-form")!.addEventListener("submit", (event: Event) => {
        event.preventDefault();
        try {
            localStorage.setItem(WEB_WORKER_KEY, setupInput.value.trim());
        } catch {
            // Private browsing can block storage; the lookup below just won't remember it.
        }
        setup.open = false;
        const appId = parseSteamAppId(new URLSearchParams(location.search).get("app") ?? "");
        if (appId !== null) {
            _webEstimate(appId);
        }
    });
}


async function _webEstimate(appId: string): Promise<void> {
    const container = document.getElementById("result")!;
    const widget = makeElement("div");
    widget.id = WEB_WIDGET_ID;
    const header = makeElement("div", "sre-header");
    const actions = makeElement("div", "sre-actions");
    const steamLink = makeElement("a", "sre-link", "Steam page") as HTMLAnchorElement;
    steamLink.href = `https://store.steampowered.com/app/${appId}/`;
    actions.append(steamLink);
    const title = makeElement("span", "sre-title", "Revenue estimate");
    header.append(title, actions);
    const body = makeElement("div", "sre-body");
    body.append(makeElement("div", "sre-muted", "Estimating…"));
    widget.append(header, body);
    container.replaceChildren(widget);

    const workerUrl = _webWorkerUrl();
    if (workerUrl === "") {
        body.replaceChildren(makeElement("div", "sre-muted", "Add your Worker URL under Setup below first."));
        (document.getElementById("setup") as HTMLDetailsElement).open = true;
        return;
    }

    try {
        const response = await fetch(`${workerUrl}/?app=${appId}`);
        const data = await response.json();
        if (!response.ok || data?.error !== undefined) {
            throw new Error(data?.error ?? `Worker returned ${response.status}`);
        }
        if (data.reviews === null) {
            throw new Error("Steam didn't return review data for this game. Try again in a minute.");
        }
        const game = buildGameData(appId, data.details, reviewSummaryFromStore(data.reviews), data.release, data.firstReviewUnix);
        const [settings, tracked] = await Promise.all([loadSettings(), loadTrackedGames()]);
        const result = estimateRevenue(game, settings);

        document.title = `${game.name} · Revenue estimate`;
        title.textContent = game.name;
        const parts: HTMLElement[] = [];
        if (game.headerImage !== "") {
            const image = document.createElement("img");
            image.className = "web-header-image";
            image.src = game.headerImage;
            image.alt = "";
            parts.push(image);
        }
        parts.push(...renderEstimate(game, settings, result));
        body.replaceChildren(...parts);
        _webMakeHoverTextTappable(body);

        if (result.kind === "estimate") {
            const isTracked = appId in tracked;
            if (isTracked) {
                // Keep the saved copy fresh whenever a tracked game is looked up again.
                await trackGame(game);
            }
            actions.prepend(_webTrackButton(game, isTracked));
        }
    } catch (error) {
        console.error("[Steam Revenue Estimator]", error);
        const message = error instanceof Error ? error.message : String(error);
        body.replaceChildren(
            makeElement("div", "sre-muted", "Couldn't load data for this game."),
            makeElement("div", "sre-footer", message),
        );
    }
}


// Phones have no hover, so values with hover text (scope reasons, dev-time notes) show it on tap instead.
function _webMakeHoverTextTappable(body: HTMLElement): void {
    for (const value of body.querySelectorAll<HTMLElement>(".sre-value[title]")) {
        const detail = makeElement("div", "web-detail", value.title);
        detail.hidden = true;
        value.after(detail);
        value.classList.add("web-tappable");
        value.removeAttribute("title");
        value.addEventListener("click", () => {
            detail.hidden = !detail.hidden;
        });
    }
}


function _webTrackButton(game: GameData, initiallyTracked: boolean): HTMLButtonElement {
    const button = makeElement("button", "sre-track") as HTMLButtonElement;
    button.type = "button";
    let tracked = initiallyTracked;
    const update = (): void => {
        button.textContent = tracked ? "✓ Tracked" : "+ Track";
        button.classList.toggle("sre-track-active", tracked);
    };
    update();
    button.addEventListener("click", async () => {
        button.disabled = true;
        try {
            if (tracked) {
                await untrackGame(game.appId);
            } else {
                await trackGame(game);
            }
            tracked = !tracked;
            update();
        } finally {
            button.disabled = false;
        }
    });
    return button;
}


function _webShowMessage(text: string): void {
    document.getElementById("result")!.replaceChildren(makeElement("p", "web-message", text));
}


if (typeof SRE_WEB !== "undefined" && document.getElementById("lookup") !== null) {
    webMain();
}
