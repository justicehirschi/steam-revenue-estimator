// Cloudflare Worker for the web version. Browsers can't call Steam's APIs directly (no CORS headers),
// so this fetches everything the estimator needs for one game and returns it as a single JSON response:
//   GET https://<your-worker>.workers.dev/?app=1145360
// Responses are cached for an hour so repeat lookups don't hit Steam.

const STORE_BROWSE_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1";
const CACHE_SECONDS = 3600;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
    async fetch(request, _env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: CORS_HEADERS });
        }
        const url = new URL(request.url);
        const appId = url.searchParams.get("app") ?? "";
        if (!/^\d{1,10}$/.test(appId)) {
            return jsonResponse({ error: "Pass a numeric Steam app ID, like ?app=1145360." }, 400);
        }

        const cache = caches.default;
        const cacheKey = new Request(`${url.origin}/?app=${appId}`);
        const cached = await cache.match(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        try {
            const [details, storeItem, firstReviewUnix] = await Promise.all([
                fetchAppDetails(appId),
                fetchStoreItem(appId),
                fetchFirstReviewUnix(appId),
            ]);
            if (details === null) {
                return jsonResponse({ error: "Steam has no store data for this app." }, 404);
            }
            const response = jsonResponse({
                appId,
                details,
                reviews: storeItem?.reviews?.summary_filtered ?? null,
                release: storeItem?.release ?? null,
                firstReviewUnix,
            }, 200, CACHE_SECONDS);
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
            return response;
        } catch (error) {
            return jsonResponse({ error: `Steam request failed: ${error}` }, 502);
        }
    },
};


async function fetchAppDetails(appId) {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english`);
    if (!response.ok) {
        throw new Error(`appdetails returned ${response.status}`);
    }
    const entry = (await response.json())?.[appId];
    return entry?.success ? entry.data : null;
}


// All-language review summary and release dates (the same call the extension's background script makes).
async function fetchStoreItem(appId) {
    const input = {
        ids: [{ appid: Number(appId) }],
        context: { language: "english", country_code: "US" },
        data_request: { include_reviews: true, include_release: true },
    };
    try {
        const response = await fetch(`${STORE_BROWSE_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`);
        if (!response.ok) {
            return null;
        }
        return (await response.json())?.response?.store_items?.[0] ?? null;
    } catch {
        return null;
    }
}


async function fetchFirstReviewUnix(appId) {
    try {
        const response = await fetch(`https://store.steampowered.com/appreviewhistogram/${appId}?l=english&review_score_preference=0`);
        const start = (await response.json())?.results?.start_date;
        return typeof start === "number" && start > 0 ? start : null;
    } catch {
        return null;
    }
}


function jsonResponse(body, status, cacheSeconds = 0) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
        },
    });
}
