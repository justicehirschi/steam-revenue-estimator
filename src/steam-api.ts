const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MULTIPLAYER_CATEGORY_IDS = new Set([1, 9, 20, 27, 36, 38, 49]);

interface ReviewSummary {
    totalReviews: number;
    allLanguages: boolean;
    scoreDesc: string;
    positivePercent: number | null;
}

interface StoreInfo {
    reviews: ReviewSummary;
    // IStoreBrowseService release block, or null when it couldn't be fetched.
    release: any | null;
}

// A first review this long before the recorded first launch means an earlier, unrecorded Early Access launch
// (pre-release key reviews rarely come more than a few weeks early).
const UNRECORDED_LAUNCH_GAP_SECONDS = 30 * 86400;


async function fetchGameData(appId: string): Promise<GameData> {
    const [details, storeInfo, firstReviewUnix] = await Promise.all([
        _fetchAppDetails(appId),
        _fetchStoreInfo(appId),
        fetchFirstReviewUnix(location.origin, appId),
    ]);
    return buildGameData(appId, details, storeInfo.reviews, storeInfo.release, firstReviewUnix);
}


// Start of Steam's review history for the app, as Unix seconds, or null if unavailable.
async function fetchFirstReviewUnix(origin: string, appId: string): Promise<number | null> {
    try {
        const response = await fetch(`${origin}/appreviewhistogram/${appId}?l=english&review_score_preference=0`);
        const start = (await response.json())?.results?.start_date;
        return typeof start === "number" && start > 0 ? start : null;
    } catch {
        return null;
    }
}


// Pure: turns appdetails data plus IStoreBrowseService data into GameData.
// Also used by the dataset scripts, so it must not touch the DOM or chrome.* APIs.
function buildGameData(appId: string, details: any, reviews: ReviewSummary, release: any | null, firstReviewUnix: number | null): GameData {
    const releaseInfo = details.release_date ?? { coming_soon: false, date: "" };
    const releaseDate = parseSteamDate(releaseInfo.date ?? "");
    const genres: string[] = Array.isArray(details.genres)
        ? details.genres.map((genre: any) => String(genre.description))
        : [];

    return {
        appId,
        name: details.name ?? `App ${appId}`,
        headerImage: details.header_image ?? "",
        genres,
        isFree: details.is_free === true,
        listPriceCents: details.price_overview?.currency === "USD" ? details.price_overview.initial : null,
        releaseDate,
        comingSoon: releaseInfo.coming_soon === true,
        totalReviews: reviews.totalReviews,
        reviewsAllLanguages: reviews.allLanguages,
        reviewScoreDesc: reviews.scoreDesc,
        positivePercent: reviews.positivePercent,
        production: _buildProductionInfo(details, genres, releaseDate, release, firstReviewUnix),
    };
}


function reviewSummaryFromStore(summary: any): ReviewSummary {
    const total = typeof summary?.review_count === "number" ? summary.review_count : 0;
    return {
        totalReviews: total,
        allLanguages: true,
        scoreDesc: summary?.review_score_label ?? "",
        positivePercent: total > 0 && typeof summary.percent_positive === "number" ? summary.percent_positive : null,
    };
}


// Handles both "Feb 23, 2021" and "23 Feb, 2021". Returns null for vague dates like "Q3 2026".
function parseSteamDate(text: string): Date | null {
    const lower = text.toLowerCase();
    const monthMatch = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
    const yearMatch = lower.match(/\b(\d{4})\b/);
    if (monthMatch === null || yearMatch === null) {
        return null;
    }
    const dayMatch = lower.match(/\b(\d{1,2})\b/);
    const day = dayMatch === null ? 1 : Number(dayMatch[1]);
    return new Date(Number(yearMatch[1]), MONTHS.indexOf(monthMatch[1]), day);
}


function _buildProductionInfo(
    details: any,
    genres: string[],
    releaseDate: Date | null,
    release: any | null,
    firstReviewUnix: number | null,
): ProductionInfo {
    // Leaving Early Access resets steam_release_date; original_steam_release_date keeps the first launch.
    const steamDates = [release?.original_steam_release_date, release?.steam_release_date]
        .map(Number)
        .filter((value) => value > 0);
    let firstReleaseUnix: number | null = steamDates.length > 0 ? Math.min(...steamDates) : null;
    if (firstReleaseUnix === null && releaseDate !== null) {
        firstReleaseUnix = Math.floor(releaseDate.getTime() / 1000);
    }
    if (firstReviewUnix !== null && firstReleaseUnix !== null && firstReviewUnix < firstReleaseUnix - UNRECORDED_LAUNCH_GAP_SECONDS) {
        firstReleaseUnix = firstReviewUnix;
    }
    const exit = Number(release?.release_from_early_access_date ?? 0);

    const { languages, fullAudio } = _countLanguages(details.supported_languages ?? "");
    const categoryIds: number[] = Array.isArray(details.categories) ? details.categories.map((c: any) => Number(c.id)) : [];
    const developers = (details.developers ?? []).map((name: string) => name.toLowerCase().trim());
    const publishers = (details.publishers ?? []).map((name: string) => name.toLowerCase().trim()).filter((name: string) => name !== "");

    return {
        firstReleaseUnix,
        earlyAccessExitUnix: exit > 0 ? exit : null,
        inEarlyAccess: genres.includes("Early Access"),
        languages,
        fullAudioLanguages: fullAudio,
        achievements: Number(details.achievements?.total ?? 0),
        multiplayer: categoryIds.some((id) => MULTIPLAYER_CATEGORY_IDS.has(id)),
        separatePublisher: publishers.length > 0 && !publishers.some((name: string) => developers.includes(name)),
        storageGb: _parseStorageGb(details.pc_requirements),
    };
}


// supported_languages looks like "English<strong>*</strong>, French<br><strong>*</strong>languages with full audio support".
function _countLanguages(html: string): { languages: number; fullAudio: number } {
    const list = html.split(/<br\s*\/?>/i)[0];
    const items = list.split(",").map((item) => item.trim()).filter((item) => item !== "");
    return {
        languages: items.length,
        fullAudio: items.filter((item) => item.includes("*")).length,
    };
}


// Reads "Storage: 25 GB available space" (or the older "Hard Drive:") from the PC requirements HTML.
function _parseStorageGb(requirements: any): number | null {
    const html = `${requirements?.minimum ?? ""} ${requirements?.recommended ?? ""}`;
    const match = html.match(/(?:Storage|Hard Drive|Hard Disk Space):\s*(?:<\/strong>)?\s*([\d.,]+)\s*(GB|MB|TB)/i);
    if (match === null) {
        return null;
    }
    const value = Number(match[1].replace(",", "."));
    const unit = match[2].toUpperCase();
    return unit === "TB" ? value * 1024 : unit === "MB" ? value / 1024 : value;
}


async function _fetchAppDetails(appId: string): Promise<any> {
    const response = await fetch(`${location.origin}/api/appdetails?appids=${appId}&cc=us&l=english`);
    if (!response.ok) {
        throw new Error(`appdetails returned ${response.status}`);
    }
    const json = await response.json();
    const entry = json?.[appId];
    if (!entry?.success) {
        throw new Error("appdetails has no data for this app");
    }
    return entry.data;
}


async function _fetchStoreInfo(appId: string): Promise<StoreInfo> {
    try {
        // Fetched by the background script; see background.ts for why.
        const response = await chrome.runtime.sendMessage({ type: "fetch-store-info", appId });
        if (response?.error !== undefined) {
            throw new Error(response.error);
        }
        return { reviews: reviewSummaryFromStore(response?.reviews), release: response?.release ?? null };
    } catch (error) {
        console.warn("[Steam Revenue Estimator] Store data unavailable, using the page's review count.", error);
    }
    return { reviews: _readReviewSummaryFromPage(), release: null };
}


function _readReviewSummaryFromPage(): ReviewSummary {
    const countMeta = document.querySelector<HTMLMetaElement>('meta[itemprop="reviewCount"]');
    const ratingRow = countMeta?.closest(".user_reviews_summary_row");
    const tooltip = ratingRow?.getAttribute("data-tooltip-html") ?? "";
    const percentMatch = tooltip.match(/(\d+)%/);

    return {
        totalReviews: Number(countMeta?.content ?? 0),
        allLanguages: false,
        scoreDesc: ratingRow?.querySelector(".game_review_summary")?.textContent?.trim() ?? "",
        positivePercent: percentMatch === null ? null : Number(percentMatch[1]),
    };
}
