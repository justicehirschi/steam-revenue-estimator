interface EstimatorSettings {
    // Copies sold per Steam review (the "Boxleiter number"). The range drives the estimate spread.
    reviewMultiplierLow: number;
    reviewMultiplierHigh: number;
    // Average price actually paid, as a fraction of the USD list price (discounts, regional pricing).
    realizedPriceRatio: number;
    // Fraction of gross refunded.
    refundRate: number;
    // Fraction of gross that is sales tax / VAT.
    taxRate: number;
}

const DEFAULT_SETTINGS: EstimatorSettings = {
    reviewMultiplierLow: 30,
    reviewMultiplierHigh: 60,
    realizedPriceRatio: 0.6,
    refundRate: 0.08,
    taxRate: 0.1,
};


async function loadSettings(): Promise<EstimatorSettings> {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...stored } as EstimatorSettings;
}
