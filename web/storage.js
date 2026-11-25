// Web version only: a stand-in for the parts of chrome.storage the extension code uses, kept in localStorage,
// so tracking, settings and the dashboard work unchanged outside the extension. Loaded before every other script.
var SRE_WEB = true;
(function () {
    var STORE_KEY = "sre-web-data";
    var state = null;
    try { state = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (error) { state = null; }
    if (!state || !state.local || !state.sync) { state = { local: {}, sync: {} }; }
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
        runtime: { id: "web", sendMessage: function () { return Promise.resolve(); } },
        storage: { local: area("local"), sync: area("sync"), onChanged: { addListener: function (fn) { listeners.push(fn); } } },
    };

    // Changes made in another tab (say, tracking a game while the dashboard is open) show up here too.
    window.addEventListener("storage", function (event) {
        if (event.key !== STORE_KEY) { return; }
        var previous = state;
        try { state = JSON.parse(event.newValue) || { local: {}, sync: {} }; } catch (error) { return; }
        ["local", "sync"].forEach(function (name) {
            var changes = {};
            Object.keys(state[name] || {}).forEach(function (key) {
                if (JSON.stringify(previous[name][key]) !== JSON.stringify(state[name][key])) {
                    changes[key] = { oldValue: previous[name][key], newValue: copy(state[name][key]) };
                }
            });
            if (Object.keys(changes).length > 0) {
                listeners.forEach(function (listener) { listener(changes, name); });
            }
        });
    });

    // Asks the browser not to clear this site's storage on its own. Backups are still the safe bet.
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(function () {}); }
})();
