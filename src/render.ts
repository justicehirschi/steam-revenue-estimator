// Builds the revenue estimate panel contents. Shared by the Steam page widget and the web version.
function renderEstimate(game: GameData, settings: EstimatorSettings, result: EstimateResult): HTMLElement[] {
    if (result.kind === "unavailable") {
        return [makeElement("div", "sre-muted", result.reason)];
    }
    const estimate = result.estimate;

    const headline = makeElement("div", "sre-headline");
    headline.append(
        makeElement("div", "sre-big", formatRange(estimate.gross, moneyFormat)),
        makeElement("div", "sre-muted", "Estimated lifetime gross revenue (USD)"),
    );
    const confidence = makeElement(
        "span",
        `sre-confidence sre-confidence-${estimate.confidence.toLowerCase()}`,
        `${estimate.confidence} confidence`,
    );

    const top = makeElement("div", "sre-top");
    top.append(headline, confidence);

    const reviewLabel = game.reviewsAllLanguages ? "Reviews" : "Reviews (page language)";
    let reviewText = fullCountFormat.format(game.totalReviews);
    if (game.positivePercent !== null) {
        reviewText += ` · ${game.positivePercent}% positive`;
    }

    // [label, value, hover text]
    const rows: [string, string, string][] = [
        ["Copies sold", formatRange(estimate.copies, countFormat), ""],
        ["Net to developer", formatRange(estimate.net, moneyFormat), ""],
    ];
    if (estimate.monthlyGross !== null) {
        rows.push(["Avg gross / month", formatRange(estimate.monthlyGross, moneyFormat), ""]);
    }
    rows.push(
        [reviewLabel, reviewText, ""],
        ["List price", priceFormat.format(game.listPriceCents! / 100), ""],
    );
    const devTime = estimateDevTime(game);
    if (devTime !== null) {
        rows.push(["Page → launch", describeDevTime(devTime), devTimeTooltip(devTime)]);
    }
    const scope = rateScope(game);
    if (scope !== null) {
        rows.push(["Scope", `${scope.level} ⓘ`, scope.reasons.join("\n")]);
    }

    const grid = makeElement("div", "sre-grid");
    for (const [label, value, hover] of rows) {
        const valueElement = makeElement("div", "sre-value", value);
        if (hover !== "") {
            valueElement.title = hover;
        }
        grid.append(makeElement("div", "sre-label", label), valueElement);
    }

    const footer = makeElement("div", "sre-footer");
    const method = `${Math.round(estimate.multiplier.low)}–${Math.round(estimate.multiplier.high)} copies per review, `
        + `${Math.round(settings.realizedPriceRatio * 100)}% of list price realized.`;
    footer.append(makeElement("div", "", method));
    for (const note of estimate.notes) {
        footer.append(makeElement("div", "", note));
    }

    return [top, grid, footer];
}
