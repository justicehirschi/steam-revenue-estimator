type ScopeLevel = "Small" | "Medium" | "Large";

interface ScopeRating {
    level: ScopeLevel;
    score: number;
    reasons: string[];
}


// Rough production-size rating from store page signals that tend to go with bigger teams and budgets.
// Each signal adds points (max 9): Small is 0–2, Medium 3–4, Large 5+. Price and install size weigh most;
// language and voice counts weigh least, since developers often tick those boxes loosely.
function rateScope(game: GameData): ScopeRating | null {
    const info = game.production;
    if (info === undefined) {
        return null;
    }
    let score = 0;
    const reasons: string[] = [];
    const add = (points: number, reason: string): void => {
        score += points;
        reasons.push(`${reason} (+${points})`);
    };

    const price = (game.listPriceCents ?? 0) / 100;
    if (price >= 30) {
        add(2, `$${price.toFixed(2)} price`);
    } else if (price >= 20) {
        add(1, `$${price.toFixed(2)} price`);
    }
    if (info.languages >= 10) {
        add(1, `${info.languages} languages`);
    }
    if (info.fullAudioLanguages >= 3) {
        add(1, `voiced in ${info.fullAudioLanguages} languages`);
    }
    if (info.storageGb !== null && info.storageGb >= 20) {
        add(2, `${Math.round(info.storageGb)} GB install`);
    } else if (info.storageGb !== null && info.storageGb >= 5) {
        add(1, `${Math.round(info.storageGb)} GB install`);
    }
    if (info.achievements >= 50) {
        add(1, `${info.achievements} achievements`);
    }
    if (info.multiplayer) {
        add(1, "multiplayer");
    }
    if (info.separatePublisher) {
        add(1, "has a publisher");
    }

    const level: ScopeLevel = score >= 5 ? "Large" : score >= 3 ? "Medium" : "Small";
    if (reasons.length === 0) {
        reasons.push("no large-production signals");
    }
    return { level, score, reasons };
}
