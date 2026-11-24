// Shared by the Steam page widget and the dashboard.
const moneyFormat = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
});
const countFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const fullCountFormat = new Intl.NumberFormat("en-US");
const priceFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });


function formatRange(range: EstimateRange, format: Intl.NumberFormat): string {
    return `${format.format(range.low)} – ${format.format(range.high)}`;
}


function makeElement(tag: string, className = "", text = ""): HTMLElement {
    const element = document.createElement(tag);
    if (className !== "") {
        element.className = className;
    }
    if (text !== "") {
        element.textContent = text;
    }
    return element;
}
