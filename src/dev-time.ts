interface DevTimeEstimate {
    // Months from the estimated Steam page creation to first launch: a lower bound on development time.
    pageToLaunchMonths: number;
    registeredAt: Date;
    earlyAccessMonths: number | null;
    inEarlyAccess: boolean;
}

// [app ID, approximate registration date] pairs. App IDs are handed out in order, so IDs between two
// anchors are interpolated. Built in Nov 2026 by sampling ~22,000 app IDs and taking the 5th-percentile
// Steam release date per 25,000-ID band (some apps launch within days of being registered), forced to
// only move forward. Older IDs (under ~200,000) are sparse, so estimates for pre-2012 games are rough.
const APP_ID_ANCHORS: [number, string][] = [
    [0, "2006-08-24"], [200000, "2012-04-23"], [300000, "2014-05-28"], [400000, "2015-10-08"],
    [500000, "2016-08-02"], [600000, "2017-03-15"], [700000, "2017-09-06"], [800000, "2018-02-28"],
    [900000, "2018-07-19"], [1000000, "2019-01-11"], [1100000, "2019-06-20"], [1200000, "2019-12-18"],
    [1300000, "2020-05-20"], [1400000, "2020-08-30"], [1500000, "2021-01-07"], [1600000, "2021-04-28"],
    [1700000, "2021-08-04"], [1800000, "2021-10-31"], [1900000, "2022-02-21"], [2000000, "2022-06-03"],
    [2100000, "2022-08-05"], [2200000, "2022-11-08"], [2300000, "2023-02-16"], [2400000, "2023-04-28"],
    [2500000, "2023-07-17"], [2600000, "2023-09-28"], [2700000, "2023-12-03"], [2800000, "2024-01-31"],
    [2900000, "2024-04-06"], [3000000, "2024-05-31"], [3100000, "2024-07-21"], [3200000, "2024-09-18"],
    [3300000, "2024-10-29"], [3400000, "2024-12-22"], [3500000, "2025-02-14"], [3600000, "2025-03-31"],
    [3700000, "2025-05-01"], [3800000, "2025-06-11"], [3900000, "2025-08-03"], [4000000, "2025-09-11"],
    [4100000, "2025-10-20"], [4200000, "2025-12-01"], [4300000, "2026-01-13"], [4400000, "2026-02-11"],
    [4500000, "2026-03-13"], [4600000, "2026-04-19"], [4700000, "2026-05-08"], [4800000, "2026-06-07"],
    [4900000, "2026-07-03"], [5000000, "2026-08-04"], [5100000, "2026-08-21"], [5200000, "2026-09-08"],
    [5300000, "2026-09-28"], [5400000, "2026-10-18"], [5500000, "2026-11-02"], [5575000, "2026-11-12"],
];

const SECONDS_PER_MONTH = 30.44 * 86400;


function estimateDevTime(game: GameData): DevTimeEstimate | null {
    const info = game.production;
    const firstReleaseUnix = info?.firstReleaseUnix
        ?? (game.releaseDate === null ? null : Math.floor(game.releaseDate.getTime() / 1000));
    const registeredUnix = estimateRegistrationUnix(Number(game.appId));
    if (firstReleaseUnix === null || registeredUnix === null) {
        return null;
    }

    let earlyAccessMonths: number | null = null;
    if (info?.earlyAccessExitUnix && info.firstReleaseUnix !== null) {
        earlyAccessMonths = Math.max(0, (info.earlyAccessExitUnix - info.firstReleaseUnix) / SECONDS_PER_MONTH);
    } else if (info?.inEarlyAccess) {
        earlyAccessMonths = Math.max(0, (Date.now() / 1000 - firstReleaseUnix) / SECONDS_PER_MONTH);
    }

    return {
        pageToLaunchMonths: Math.max(0, (firstReleaseUnix - registeredUnix) / SECONDS_PER_MONTH),
        registeredAt: new Date(registeredUnix * 1000),
        earlyAccessMonths,
        inEarlyAccess: info?.inEarlyAccess ?? false,
    };
}


function estimateRegistrationUnix(appId: number): number | null {
    if (APP_ID_ANCHORS.length < 2 || !Number.isFinite(appId)) {
        return null;
    }
    const toUnix = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 1000;
    let lower = APP_ID_ANCHORS[0];
    let upper = APP_ID_ANCHORS[1];
    for (let index = 1; index < APP_ID_ANCHORS.length; index++) {
        upper = APP_ID_ANCHORS[index];
        lower = APP_ID_ANCHORS[index - 1];
        if (appId <= upper[0]) {
            break;
        }
    }
    // Interpolate between neighbours, extrapolating from the last pair beyond the table, never past today.
    const fraction = (appId - lower[0]) / (upper[0] - lower[0]);
    const estimate = toUnix(lower[1]) + fraction * (toUnix(upper[1]) - toUnix(lower[1]));
    return Math.min(estimate, Date.now() / 1000);
}


function formatMonths(months: number): string {
    if (months < 1) {
        return "<1 mo";
    }
    if (months < 24) {
        return `${Math.round(months)} mo`;
    }
    return `${(months / 12).toFixed(1)} yr`;
}


function describeDevTime(devTime: DevTimeEstimate): string {
    let text = formatMonths(devTime.pageToLaunchMonths);
    if (devTime.inEarlyAccess) {
        text += " · in Early Access";
    } else if (devTime.earlyAccessMonths !== null) {
        text += ` + ${formatMonths(devTime.earlyAccessMonths)} EA`;
    }
    return text;
}


function devTimeTooltip(devTime: DevTimeEstimate): string {
    const registered = devTime.registeredAt.toLocaleDateString("en-US", { year: "numeric", month: "short" });
    let text = `Steam page created around ${registered} (estimated from the app ID). `
        + "Development usually starts well before the page exists, so treat this as a minimum.";
    if (devTime.earlyAccessMonths !== null) {
        text += `\nEarly Access: ${formatMonths(devTime.earlyAccessMonths)}${devTime.inEarlyAccess ? " so far" : ""}.`;
    }
    return text;
}
