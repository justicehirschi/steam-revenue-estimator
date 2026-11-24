interface BackupFile {
    format: string;
    version: number;
    exportedAt: string;
    settings: EstimatorSettings;
    trackedGames: Record<string, TrackedGame>;
}

interface ParsedBackup {
    settings: EstimatorSettings | null;
    trackedGames: Record<string, TrackedGame>;
    skipped: number;
}

const BACKUP_FORMAT = "steam-revenue-estimator-backup";
const BACKUP_VERSION = 1;


async function createBackup(): Promise<string> {
    const backup: BackupFile = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        settings: await loadSettings(),
        trackedGames: await loadTrackedGames(),
    };
    return JSON.stringify(backup, null, 2);
}


// Throws with a readable message if the file isn't a backup; skips individual entries that look broken.
function parseBackup(text: string): ParsedBackup {
    let data: any;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("That file isn't valid JSON.");
    }
    if (data?.format !== BACKUP_FORMAT) {
        throw new Error("That file isn't a Steam Revenue Estimator backup.");
    }
    if (typeof data.version !== "number" || data.version > BACKUP_VERSION) {
        throw new Error("That backup was made by a newer version of the extension.");
    }

    const trackedGames: Record<string, TrackedGame> = {};
    let skipped = 0;
    for (const [appId, entry] of Object.entries<any>(data.trackedGames ?? {})) {
        if (_isValidEntry(appId, entry)) {
            trackedGames[appId] = entry;
        } else {
            skipped++;
        }
    }
    return { settings: _parseSettings(data.settings), trackedGames, skipped };
}


function _isValidEntry(appId: string, entry: any): entry is TrackedGame {
    const game = entry?.game;
    return /^\d+$/.test(appId)
        && game?.appId === appId
        && typeof game.name === "string"
        && typeof game.totalReviews === "number"
        && Array.isArray(game.genres)
        && typeof entry.trackedAt === "string"
        && typeof entry.updatedAt === "string";
}


function _parseSettings(raw: any): EstimatorSettings | null {
    if (typeof raw !== "object" || raw === null) {
        return null;
    }
    const settings = { ...DEFAULT_SETTINGS };
    for (const field of Object.keys(DEFAULT_SETTINGS) as (keyof EstimatorSettings)[]) {
        const value = raw[field];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            return null;
        }
        settings[field] = value;
    }
    return settings;
}
