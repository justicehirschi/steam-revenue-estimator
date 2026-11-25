// Builds a single self-contained HTML file of the dashboard: the extension's own page and scripts,
// inlined, plus a stand-in for chrome.storage that starts from a snapshot of the current data and keeps
// any changes in the viewer's browser (localStorage). Works when opened straight from disk.

interface ShareSnapshot {
    id: string;
    createdAt: string;
    settings: EstimatorSettings;
    trackedGames: Record<string, TrackedGame>;
}

// Set by the stand-in inside a shared page, so the page can hide extension-only controls.
declare const SRE_SHARED: boolean | undefined;


function isSharedCopy(): boolean {
    return typeof SRE_SHARED !== "undefined" && SRE_SHARED === true;
}

// Set by web/storage.js in the web (phone) version, which keeps data in the browser instead of the extension.
declare const SRE_WEB: boolean | undefined;


function isWebApp(): boolean {
    return typeof SRE_WEB !== "undefined" && SRE_WEB === true;
}


async function createShareablePage(): Promise<string> {
    const snapshot: ShareSnapshot = {
        id: Date.now().toString(36),
        createdAt: new Date().toISOString(),
        settings: await loadSettings(),
        trackedGames: await loadTrackedGames(),
    };

    let html = await (await fetch("options.html")).text();
    const scriptTags = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)];
    for (const [tag, path] of scriptTags) {
        const code = await (await fetch(path)).text();
        html = html.replace(tag, () => `<script>\n${_escapeForScript(code)}\n</script>`);
    }

    const shim = `<script>\n${_escapeForScript(_storageShim(snapshot))}\n</script>`;
    html = html.replace("<body>", () => `<body>\n${shim}`);
    html = html.replace("<main>", () => `<main>\n${_sharedBanner(snapshot)}`);
    html = html.replace("</style>", () => `${SHARED_STYLES}\n</style>`);
    return html;
}


// Keeps a literal "</script>" (in code or game names) from ending the inline script early.
function _escapeForScript(code: string): string {
    return code.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}


function _sharedBanner(snapshot: ShareSnapshot): string {
    const date = new Date(snapshot.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return `<div class="shared-banner" role="note">
            <span><strong>Shared snapshot</strong> from ${date}. Changes you make here stay in your browser only.</span>
            <button type="button" class="link-button" onclick="sreResetSnapshot()">Reset to original</button>
        </div>`;
}


// Runs before every other script in the shared page. Mirrors the parts of chrome.storage the dashboard uses.
function _storageShim(snapshot: ShareSnapshot): string {
    const seed = JSON.stringify({ local: { trackedGames: snapshot.trackedGames }, sync: snapshot.settings })
        .replace(/</g, "\\u003c");
    return `
var SRE_SHARED = true;
(function () {
    var STORE_KEY = "sre-shared-${snapshot.id}";
    var SEED = ${seed};
    var state = null;
    try { state = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (error) { state = null; }
    if (!state || !state.local || !state.sync) { state = JSON.parse(JSON.stringify(SEED)); }
    var listeners = [];
    function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (error) {} }
    function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function area(name) {
        return {
            get: function (keys) {
                var data = state[name];
                var result = {};
                if (keys === null || keys === undefined) {
                    Object.keys(data).forEach(function (key) { result[key] = copy(data[key]); });
                } else if (typeof keys === "string" || Array.isArray(keys)) {
                    [].concat(keys).forEach(function (key) { if (key in data) { result[key] = copy(data[key]); } });
                } else {
                    Object.keys(keys).forEach(function (key) { result[key] = key in data ? copy(data[key]) : keys[key]; });
                }
                return Promise.resolve(result);
            },
            set: function (items) {
                var changes = {};
                Object.keys(items).forEach(function (key) {
                    changes[key] = { oldValue: state[name][key], newValue: copy(items[key]) };
                    state[name][key] = copy(items[key]);
                });
                persist();
                listeners.forEach(function (listener) { listener(changes, name); });
                return Promise.resolve();
            },
        };
    }
    window.chrome = {
        runtime: { id: "shared-snapshot", sendMessage: function () { return Promise.resolve(); } },
        storage: { local: area("local"), sync: area("sync"), onChanged: { addListener: function (fn) { listeners.push(fn); } } },
    };
    window.sreResetSnapshot = function () {
        if (!window.confirm("Discard your changes and go back to the original snapshot?")) { return; }
        try { localStorage.removeItem(STORE_KEY); } catch (error) {}
        location.reload();
    };
})();`;
}


const SHARED_STYLES = `
        .shared-banner {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 20px;
            padding: 10px 16px;
            border-radius: 10px;
            background: var(--accent-soft);
            font-size: 14px;
        }
        .extension-only { display: none !important; }`;
