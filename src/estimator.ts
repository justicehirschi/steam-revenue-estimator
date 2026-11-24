interface GameData {
    appId: string;
    name: string;
    headerImage: string;
    genres: string[];
    isFree: boolean;
    // USD list price in cents, ignoring any active discount.
    listPriceCents: number | null;
    releaseDate: Date | null;
    comingSoon: boolean;
    totalReviews: number;
    // False when only the page's language-filtered count was available.
    reviewsAllLanguages: boolean;
    reviewScoreDesc: string;
    positivePercent: number | null;
    // Inputs for the dev-time and scope columns. Missing on games tracked before those existed.
    production?: ProductionInfo;
}

interface ProductionInfo {
    // First launch on Steam (including Early Access) and Early Access exit, as Unix seconds.
    firstReleaseUnix: number | null;
    earlyAccessExitUnix: number | null;
    inEarlyAccess: boolean;
    languages: number;
    fullAudioLanguages: number;
    achievements: number;
    multiplayer: boolean;
    separatePublisher: boolean;
    storageGb: number | null;
}

interface EstimateRange {
    low: number;
    high: number;
}

type Confidence = "Low" | "Medium";

interface Estimate {
    copies: EstimateRange;
    gross: EstimateRange;
    net: EstimateRange;
    monthlyGross: EstimateRange | null;
    confidence: Confidence;
    multiplier: EstimateRange;
    notes: string[];
}

type EstimateResult =
    | { kind: "estimate"; estimate: Estimate }
    | { kind: "unavailable"; reason: string };

const DAYS_PER_MONTH = 30.44;
const MS_PER_DAY = 86_400_000;


function estimateRevenue(game: GameData, settings: EstimatorSettings): EstimateResult {
    if (game.comingSoon) {
        return { kind: "unavailable", reason: "Not released yet." };
    }
    if (game.isFree) {
        return { kind: "unavailable", reason: "Free to play: review-based revenue estimates don't apply." };
    }
    if (game.listPriceCents === null) {
        return { kind: "unavailable", reason: "No USD list price available for this game." };
    }
    if (game.totalReviews === 0) {
        return { kind: "unavailable", reason: "No reviews yet." };
    }

    const notes: string[] = [];
    const ageFactor = _reviewEraFactor(game.releaseDate);
    if (ageFactor > 1) {
        notes.push(`Older release: copies per review scaled by ${ageFactor}x.`);
    }

    const multiplier: EstimateRange = {
        low: settings.reviewMultiplierLow * ageFactor,
        high: settings.reviewMultiplierHigh * ageFactor,
    };
    const copies: EstimateRange = {
        low: game.totalReviews * multiplier.low,
        high: game.totalReviews * multiplier.high,
    };

    const realizedPrice = (game.listPriceCents / 100) * settings.realizedPriceRatio;
    const gross: EstimateRange = {
        low: copies.low * realizedPrice,
        high: copies.high * realizedPrice,
    };

    const afterRefundsAndTax = (1 - settings.refundRate) * (1 - settings.taxRate);
    const net: EstimateRange = {
        low: _developerShare(gross.low * afterRefundsAndTax),
        high: _developerShare(gross.high * afterRefundsAndTax),
    };

    let monthlyGross: EstimateRange | null = null;
    const ageDays = _ageInDays(game.releaseDate);
    if (ageDays !== null) {
        const months = Math.max(1, ageDays / DAYS_PER_MONTH);
        monthlyGross = { low: gross.low / months, high: gross.high / months };
    }

    let confidence: Confidence = "Medium";
    if (game.totalReviews < 100) {
        confidence = "Low";
        notes.push("Under 100 reviews: small samples swing a lot.");
    }
    if (ageDays !== null && ageDays < 60) {
        confidence = "Low";
        notes.push("Released recently: review rates are still settling.");
    }
    if (!game.reviewsAllLanguages) {
        confidence = "Low";
        notes.push("Only the page's language-filtered review count was available, so this likely undercounts.");
    }

    return {
        kind: "estimate",
        estimate: { copies, gross, net, monthlyGross, confidence, multiplier, notes },
    };
}


// Steam reviews launched in late 2013 and review prompts got more aggressive over time,
// so older games have fewer reviews per copy sold.
function _reviewEraFactor(releaseDate: Date | null): number {
    if (releaseDate === null) {
        return 1;
    }
    const year = releaseDate.getFullYear();
    if (year < 2014) {
        return 1.6;
    }
    if (year < 2017) {
        return 1.3;
    }
    if (year < 2020) {
        return 1.1;
    }
    return 1;
}


// Steam's tiered revenue share: 70% to the developer up to $10M, 75% from $10M to $50M, 80% above.
function _developerShare(revenue: number): number {
    const tier1 = Math.min(revenue, 10_000_000);
    const tier2 = Math.min(Math.max(revenue - 10_000_000, 0), 40_000_000);
    const tier3 = Math.max(revenue - 50_000_000, 0);
    return tier1 * 0.7 + tier2 * 0.75 + tier3 * 0.8;
}


function _ageInDays(releaseDate: Date | null): number | null {
    if (releaseDate === null) {
        return null;
    }
    const days = (Date.now() - releaseDate.getTime()) / MS_PER_DAY;
    return days >= 0 ? days : null;
}
