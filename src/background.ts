interface BackgroundMessage {
    type?: string;
    appId?: string;
}

const STORE_BROWSE_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1";


// Content scripts can't open the options page, and api.steampowered.com doesn't allow
// requests from store pages (no CORS headers), so both are handled here.
chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
    if (message?.type === "open-options") {
        chrome.runtime.openOptionsPage();
        return false;
    }
    if (message?.type === "fetch-store-info" && typeof message.appId === "string") {
        _requestStoreInfo(message.appId)
            .then(sendResponse)
            .catch((error: unknown) => sendResponse({ error: String(error) }));
        // Keeps the message channel open for the async response.
        return true;
    }
    return false;
});


// Returns Steam's all-language review summary ("summary_filtered") and release dates.
async function _requestStoreInfo(appId: string): Promise<{ reviews: object | null; release: object | null }> {
    const input = {
        ids: [{ appid: Number(appId) }],
        context: { language: "english", country_code: "US" },
        data_request: { include_reviews: true, include_release: true },
    };
    const url = `${STORE_BROWSE_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`GetItems returned ${response.status}`);
    }
    const json = await response.json();
    const item = json?.response?.store_items?.[0];
    return { reviews: item?.reviews?.summary_filtered ?? null, release: item?.release ?? null };
}
