// Tracked games keep the raw Steam inputs, not the estimate, so the dashboard
// recomputes everything with the current settings.
type StoredGameData = Omit<GameData, "releaseDate"> & { releaseDate: string | null };

interface TrackedGame {
    game: StoredGameData;
    trackedAt: string;
    updatedAt: string;
}

const TRACKED_KEY = "trackedGames";


async function loadTrackedGames(): Promise<Record<string, TrackedGame>> {
    const stored = await chrome.storage.local.get(TRACKED_KEY);
    return (stored[TRACKED_KEY] ?? {}) as Record<string, TrackedGame>;
}


async function trackGame(game: GameData): Promise<void> {
    const games = await loadTrackedGames();
    const now = new Date().toISOString();
    games[game.appId] = {
        game: _toStored(game),
        trackedAt: games[game.appId]?.trackedAt ?? now,
        updatedAt: now,
    };
    await chrome.storage.local.set({ [TRACKED_KEY]: games });
}


async function untrackGame(appId: string): Promise<void> {
    const games = await loadTrackedGames();
    delete games[appId];
    await chrome.storage.local.set({ [TRACKED_KEY]: games });
}


async function clearTrackedGames(): Promise<void> {
    await chrome.storage.local.set({ [TRACKED_KEY]: {} });
}


// Adds games from a backup. When a game exists on both sides, the more recently updated copy wins
// (or the one with production data, if only it has some), and the earliest "tracked" date is kept.
// Returns how many games were added or updated.
async function mergeTrackedGames(incoming: Record<string, TrackedGame>): Promise<number> {
    const games = await loadTrackedGames();
    let changed = 0;
    for (const [appId, entry] of Object.entries(incoming)) {
        const existing = games[appId];
        if (existing === undefined) {
            games[appId] = entry;
            changed++;
        } else if (entry.updatedAt > existing.updatedAt || (existing.game.production === undefined && entry.game.production !== undefined)) {
            // Newer copy wins; a copy with scope/dev-time data also replaces one without it.
            games[appId] = { ...entry, trackedAt: entry.trackedAt < existing.trackedAt ? entry.trackedAt : existing.trackedAt };
            changed++;
        }
    }
    await chrome.storage.local.set({ [TRACKED_KEY]: games });
    return changed;
}


function gameFromStored(stored: StoredGameData): GameData {
    return { ...stored, releaseDate: stored.releaseDate === null ? null : new Date(stored.releaseDate) };
}


function _toStored(game: GameData): StoredGameData {
    return { ...game, releaseDate: game.releaseDate === null ? null : game.releaseDate.toISOString() };
}
