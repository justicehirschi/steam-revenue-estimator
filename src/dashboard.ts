type Metric = "gross" | "net" | "copies" | "monthlyGross";
type SortKey = "name" | "released" | "price" | "reviews" | "copies" | "gross" | "net" | "monthlyGross" | "devTime" | "scope";
type GenreMode = "total" | "average";

interface DashboardRow {
    game: GameData;
    estimate: Estimate | null;
    trackedAt: Date;
}

interface BarItem {
    label: string;
    low: number;
    high: number;
    tooltip: string[];
}

interface Column {
    key: SortKey;
    label: string;
    numeric: boolean;
    sortValue: (row: DashboardRow) => number | string;
    render: (row: DashboardRow) => string;
    hover?: (row: DashboardRow) => string;
    // Shows the value as a small pill instead of plain text.
    badge?: boolean;
    // Hidden until switched on in the column checkboxes.
    defaultHidden?: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const GAME_CHART_LIMIT = 15;

const METRIC_LABELS: Record<Metric, string> = {
    gross: "Lifetime gross",
    net: "Net to developer",
    copies: "Copies sold",
    monthlyGross: "Avg gross / month",
};

const dashboardState = {
    metric: "gross" as Metric,
    sortKey: "gross" as SortKey,
    sortAscending: false,
    genreMode: "total" as GenreMode,
    showAllGames: false,
    rows: [] as DashboardRow[],
    // Column key -> visible, for columns the user has toggled. Others use their default.
    columnVisibility: {} as Partial<Record<SortKey, boolean>>,
};

const COLUMN_VISIBILITY_KEY = "sre-column-visibility";

const COLUMNS: Column[] = [
    {
        key: "name", label: "Game", numeric: false,
        sortValue: (row) => row.game.name.toLowerCase(),
        render: (row) => row.game.name,
    },
    {
        key: "released", label: "Released", numeric: true,
        sortValue: (row) => row.game.releaseDate?.getTime() ?? 0,
        render: (row) => row.game.releaseDate?.toLocaleDateString("en-US", { year: "numeric", month: "short" }) ?? "—",
    },
    {
        key: "price", label: "Price", numeric: true,
        sortValue: (row) => row.game.listPriceCents ?? 0,
        render: (row) => row.game.listPriceCents === null ? "—" : priceFormat.format(row.game.listPriceCents / 100),
    },
    {
        key: "reviews", label: "Reviews", numeric: true,
        sortValue: (row) => row.game.totalReviews,
        render: (row) => fullCountFormat.format(row.game.totalReviews),
    },
    _metricColumn("copies", "Copies"),
    {
        ..._metricColumn("gross", "Gross"),
        hover: (row) => row.estimate === null ? "" : `Net to developer: ${formatRange(row.estimate.net, moneyFormat)}`,
    },
    { ..._metricColumn("net", "Net"), defaultHidden: true },
    _metricColumn("monthlyGross", "Gross / mo"),
    {
        key: "devTime", label: "Page → launch", numeric: true,
        sortValue: (row) => estimateDevTime(row.game)?.pageToLaunchMonths ?? -1,
        render: (row) => {
            const devTime = estimateDevTime(row.game);
            if (devTime === null) {
                return "—";
            }
            const ea = devTime.inEarlyAccess ? " · EA" : devTime.earlyAccessMonths !== null ? ` +${formatMonths(devTime.earlyAccessMonths)} EA` : "";
            return formatMonths(devTime.pageToLaunchMonths) + ea;
        },
        hover: (row) => {
            const devTime = estimateDevTime(row.game);
            return devTime === null ? "" : devTimeTooltip(devTime);
        },
    },
    {
        key: "scope", label: "Scope", numeric: false,
        sortValue: (row) => rateScope(row.game)?.score ?? -1,
        render: (row) => rateScope(row.game)?.level.charAt(0) ?? "—",
        hover: (row) => {
            const scope = rateScope(row.game);
            return scope === null
                ? "No scope data saved for this game yet. Revisit its store page, or restore a refreshed backup."
                : `${scope.level} scope (score ${scope.score}/9)\n${scope.reasons.join("\n")}`;
        },
        badge: true,
    },
];


async function renderDashboard(settings: EstimatorSettings): Promise<void> {
    const tracked = await loadTrackedGames();
    dashboardState.rows = Object.values(tracked).map((entry) => {
        const game = gameFromStored(entry.game);
        const result = estimateRevenue(game, settings);
        return {
            game,
            estimate: result.kind === "estimate" ? result.estimate : null,
            trackedAt: new Date(entry.trackedAt),
        };
    });

    const isEmpty = dashboardState.rows.length === 0;
    document.getElementById("dashboard-empty")!.hidden = !isEmpty;
    document.getElementById("dashboard-content")!.hidden = isEmpty;
    if (isEmpty) {
        return;
    }
    _renderSummary();
    renderCharts();
    _renderTable();
}


function initDashboardControls(): void {
    const metricSelect = document.getElementById("chart-metric") as HTMLSelectElement;
    for (const [value, label] of Object.entries(METRIC_LABELS)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        metricSelect.append(option);
    }
    metricSelect.value = dashboardState.metric;
    metricSelect.addEventListener("change", () => {
        dashboardState.metric = metricSelect.value as Metric;
        renderCharts();
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-genre-mode]")) {
        button.addEventListener("click", () => {
            dashboardState.genreMode = button.dataset.genreMode as GenreMode;
            renderCharts();
        });
    }
    document.getElementById("toggle-all-games")!.addEventListener("click", () => {
        dashboardState.showAllGames = !dashboardState.showAllGames;
        renderCharts();
    });
    document.getElementById("export-csv")!.addEventListener("click", _exportCsv);
    _initColumnToggles();
}


function renderCharts(): void {
    const metric = dashboardState.metric;
    const format = metric === "copies" ? countFormat : moneyFormat;
    const metricLabel = METRIC_LABELS[metric];

    const gameItems: BarItem[] = [];
    for (const row of dashboardState.rows) {
        const range = _metricRange(row, metric);
        if (range === null) {
            continue;
        }
        gameItems.push({
            label: row.game.name,
            low: range.low,
            high: range.high,
            tooltip: [`${metricLabel}: ${formatRange(range, format)}`, `${row.estimate!.confidence} confidence`],
        });
    }
    gameItems.sort((a, b) => _midpoint(b) - _midpoint(a));

    const toggle = document.getElementById("toggle-all-games")!;
    toggle.hidden = gameItems.length <= GAME_CHART_LIMIT;
    toggle.textContent = dashboardState.showAllGames ? "Show top 15" : `Show all ${gameItems.length}`;
    const visibleGames = dashboardState.showAllGames ? gameItems : gameItems.slice(0, GAME_CHART_LIMIT);
    _renderBarChart(document.getElementById("chart-games")!, visibleGames, format, `${metricLabel} by game`);

    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-genre-mode]")) {
        button.setAttribute("aria-pressed", String(button.dataset.genreMode === dashboardState.genreMode));
    }
    const genreLabel = dashboardState.genreMode === "average" ? `Average ${metricLabel.toLowerCase()} per game` : `Total ${metricLabel.toLowerCase()}`;
    _renderBarChart(document.getElementById("chart-genres")!, _genreItems(metric, format), format, `${genreLabel} by genre`);
}


function _genreItems(metric: Metric, format: Intl.NumberFormat): BarItem[] {
    const groups = new Map<string, { low: number; high: number; games: string[] }>();
    for (const row of dashboardState.rows) {
        const range = _metricRange(row, metric);
        if (range === null) {
            continue;
        }
        const genres = row.game.genres.length > 0 ? row.game.genres : ["Uncategorized"];
        for (const genre of genres) {
            const group = groups.get(genre) ?? { low: 0, high: 0, games: [] };
            group.low += range.low;
            group.high += range.high;
            group.games.push(row.game.name);
            groups.set(genre, group);
        }
    }

    const averaging = dashboardState.genreMode === "average";
    const metricLabel = METRIC_LABELS[metric];
    const items: BarItem[] = [];
    for (const [genre, group] of groups) {
        const count = group.games.length;
        const range = { low: group.low / (averaging ? count : 1), high: group.high / (averaging ? count : 1) };
        const shown = group.games.slice(0, 3).join(", ") + (count > 3 ? `, +${count - 3} more` : "");
        items.push({
            label: `${genre} (${count})`,
            low: range.low,
            high: range.high,
            tooltip: [
                `${averaging ? "Average" : "Total"} ${metricLabel.toLowerCase()}: ${formatRange(range, format)}`,
                `${count} ${count === 1 ? "game" : "games"}: ${shown}`,
            ],
        });
    }
    return items.sort((a, b) => _midpoint(b) - _midpoint(a));
}


// Vertical bars: the bar is the midpoint estimate, the thin line through it is the low–high range.
function _renderBarChart(container: HTMLElement, items: BarItem[], format: Intl.NumberFormat, ariaLabel: string): void {
    container.replaceChildren();
    if (items.length === 0) {
        container.append(makeElement("p", "muted", "No estimates to chart for this metric."));
        return;
    }

    const width = Math.max(container.clientWidth, 320);
    const rightPad = 8;
    const topPad = 22;
    const plotHeight = 260;
    const plotRight = width - rightPad;
    // Names go flat under wide columns and slant under narrow ones; slanted names need extra room on the left.
    const slanted = (plotRight - 56) / items.length < 110;
    const plotLeft = slanted ? 84 : 56;
    const band = (plotRight - plotLeft) / items.length;
    const labelArea = slanted ? 100 : 30;
    const plotTop = topPad;
    const plotBottom = plotTop + plotHeight;
    const height = plotBottom + labelArea;
    const barWidth = Math.min(44, band * 0.62);
    const showValues = band >= 52;

    const ticks = _niceTicks(Math.max(...items.map((item) => item.high)));
    const domainMax = ticks[ticks.length - 1];
    const scaleY = (value: number): number => plotBottom - (value / domainMax) * plotHeight;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", ariaLabel);

    for (const tick of ticks) {
        const y = scaleY(tick);
        svg.append(_svg("line", { x1: plotLeft, x2: plotRight, y1: y, y2: y, class: tick === 0 ? "baseline" : "grid" }));
        const label = _svg("text", { x: plotLeft - 8, y: y + 4, class: "tick", "text-anchor": "end" });
        label.textContent = format.format(tick);
        svg.append(label);
    }

    const tooltip = makeElement("div", "tooltip");
    tooltip.hidden = true;

    items.forEach((item, index) => {
        const centerX = plotLeft + band * (index + 0.5);
        const group = _svg("g", { class: "chart-row" });
        group.style.setProperty("--delay", `${Math.min(index * 30, 400)}ms`);

        group.append(_svg("rect", { x: centerX - band / 2 + 1, y: plotTop - topPad, width: band - 2, height: height, rx: 6, class: "hit" }));

        const barTop = Math.min(scaleY(_midpoint(item)), plotBottom - 2);
        group.append(_svg("path", { d: _roundedColumnPath(centerX - barWidth / 2, barWidth, barTop, plotBottom), class: "bar" }));

        const lowY = scaleY(item.low);
        const highY = scaleY(item.high);
        const capHalf = Math.min(5, barWidth / 3);
        group.append(
            _svg("line", { x1: centerX, x2: centerX, y1: lowY, y2: highY, class: "whisker" }),
            _svg("line", { x1: centerX - capHalf, x2: centerX + capHalf, y1: lowY, y2: lowY, class: "whisker" }),
            _svg("line", { x1: centerX - capHalf, x2: centerX + capHalf, y1: highY, y2: highY, class: "whisker" }),
        );

        if (showValues) {
            const value = _svg("text", { x: centerX, y: highY - 7, class: "value", "text-anchor": "middle" });
            value.textContent = format.format(_midpoint(item));
            group.append(value);
        }

        const labelY = plotBottom + 16;
        const name = slanted
            ? _svg("text", { x: centerX, y: labelY, class: "row-label", "text-anchor": "end", transform: `rotate(-40 ${centerX} ${labelY})` })
            : _svg("text", { x: centerX, y: labelY, class: "row-label", "text-anchor": "middle" });
        name.textContent = _truncate(item.label, slanted ? 18 : Math.floor(band / 7));
        group.append(name);

        group.addEventListener("mousemove", (event: MouseEvent) => {
            tooltip.replaceChildren(
                makeElement("div", "tooltip-title", item.label),
                ...item.tooltip.map((line, lineIndex) => makeElement("div", lineIndex === 0 ? "" : "muted", line)),
            );
            tooltip.hidden = false;
            const bounds = container.getBoundingClientRect();
            const left = Math.min(event.clientX - bounds.left + 14, bounds.width - tooltip.offsetWidth - 4);
            tooltip.style.left = `${Math.max(0, left)}px`;
            tooltip.style.top = `${event.clientY - bounds.top + 14}px`;
        });
        group.addEventListener("mouseleave", () => {
            tooltip.hidden = true;
        });
        svg.append(group);
    });

    container.append(svg, tooltip);
}


// Flat on the baseline, rounded (4px) at the top.
function _roundedColumnPath(x: number, width: number, top: number, bottom: number): string {
    const radius = Math.min(4, width / 2, (bottom - top) / 2);
    return `M${x},${bottom} V${top + radius} Q${x},${top} ${x + radius},${top} `
        + `H${x + width - radius} Q${x + width},${top} ${x + width},${top + radius} V${bottom} Z`;
}


// 0 plus 3–5 evenly spaced "round" ticks (1, 2, 2.5 or 5 × 10^n) covering maxValue.
function _niceTicks(maxValue: number): number[] {
    if (maxValue <= 0) {
        return [0, 1];
    }
    const rawStep = maxValue / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;
    const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
    const ticks: number[] = [];
    for (let value = 0; value < maxValue + niceStep * 0.999; value += niceStep) {
        ticks.push(value);
    }
    return ticks;
}


function _midpoint(item: BarItem): number {
    return (item.low + item.high) / 2;
}


function _renderSummary(): void {
    const estimated = dashboardState.rows.filter((row) => row.estimate !== null).map((row) => row.estimate!);
    const sum = (pick: (estimate: Estimate) => EstimateRange): EstimateRange => ({
        low: estimated.reduce((total, estimate) => total + pick(estimate).low, 0),
        high: estimated.reduce((total, estimate) => total + pick(estimate).high, 0),
    });
    const midpoints = estimated.map((estimate) => (estimate.gross.low + estimate.gross.high) / 2).sort((a, b) => a - b);
    const middle = Math.floor(midpoints.length / 2);
    let median: number | null = null;
    if (midpoints.length > 0) {
        median = midpoints.length % 2 === 1 ? midpoints[middle] : (midpoints[middle - 1] + midpoints[middle]) / 2;
    }

    document.getElementById("summary")!.replaceChildren(
        _tile("Games tracked", String(dashboardState.rows.length)),
        _tile("Combined gross", estimated.length > 0 ? formatRange(sum((e) => e.gross), moneyFormat) : "—"),
        _tile("Combined net", estimated.length > 0 ? formatRange(sum((e) => e.net), moneyFormat) : "—"),
        _tile("Median game gross", median === null ? "—" : moneyFormat.format(median)),
    );
}


function _renderTable(): void {
    const column = COLUMNS.find((candidate) => candidate.key === dashboardState.sortKey) ?? COLUMNS[0];
    const direction = dashboardState.sortAscending ? 1 : -1;
    const rows = [...dashboardState.rows].sort((a, b) => {
        const left = column.sortValue(a);
        const right = column.sortValue(b);
        return (left < right ? -1 : left > right ? 1 : 0) * direction;
    });

    const headRow = document.createElement("tr");
    for (const candidate of _visibleColumns()) {
        const th = makeElement("th", candidate.numeric ? "numeric" : "");
        const button = makeElement("button", "sort", candidate.label) as HTMLButtonElement;
        button.type = "button";
        if (candidate.key === dashboardState.sortKey) {
            button.textContent += dashboardState.sortAscending ? " ▲" : " ▼";
            th.setAttribute("aria-sort", dashboardState.sortAscending ? "ascending" : "descending");
        }
        button.addEventListener("click", () => {
            if (dashboardState.sortKey === candidate.key) {
                dashboardState.sortAscending = !dashboardState.sortAscending;
            } else {
                dashboardState.sortKey = candidate.key;
                dashboardState.sortAscending = !candidate.numeric;
            }
            _renderTable();
        });
        th.append(button);
        headRow.append(th);
    }
    headRow.append(makeElement("th"));

    const body = document.createElement("tbody");
    for (const row of rows) {
        const tr = document.createElement("tr");
        for (const candidate of _visibleColumns()) {
            const td = makeElement("td", candidate.numeric ? "numeric" : "");
            if (candidate.key === "name") {
                td.append(_gameCell(row));
            } else {
                const text = candidate.render(row);
                const hover = candidate.hover?.(row) ?? "";
                if (candidate.badge && text !== "—") {
                    const badge = makeElement("span", `badge badge-${text.toLowerCase()}`, text);
                    badge.title = hover;
                    td.append(badge);
                } else {
                    td.textContent = text;
                    if (hover !== "") {
                        td.title = hover;
                        td.classList.add("has-hover");
                    }
                }
            }
            tr.append(td);
        }
        const removeCell = makeElement("td", "numeric");
        const removeButton = makeElement("button", "remove", "✕") as HTMLButtonElement;
        removeButton.type = "button";
        removeButton.title = `Stop tracking ${row.game.name}`;
        removeButton.setAttribute("aria-label", `Stop tracking ${row.game.name}`);
        removeButton.addEventListener("click", () => untrackGame(row.game.appId));
        removeCell.append(removeButton);
        tr.append(removeCell);
        body.append(tr);
    }

    const head = document.createElement("thead");
    head.append(headRow);
    document.getElementById("games-table")!.replaceChildren(head, body);
}


function _initColumnToggles(): void {
    try {
        dashboardState.columnVisibility = JSON.parse(localStorage.getItem(COLUMN_VISIBILITY_KEY) ?? "{}");
    } catch {
        dashboardState.columnVisibility = {};
    }

    const container = document.getElementById("column-toggles")!;
    container.replaceChildren(makeElement("span", "toggles-label", "Columns:"));
    // The game name always shows; everything else can be toggled.
    for (const column of COLUMNS.filter((candidate) => candidate.key !== "name")) {
        const label = makeElement("label", "toggle");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = _isColumnVisible(column);
        checkbox.addEventListener("change", () => {
            dashboardState.columnVisibility[column.key] = checkbox.checked;
            try {
                localStorage.setItem(COLUMN_VISIBILITY_KEY, JSON.stringify(dashboardState.columnVisibility));
            } catch {
                // Not saved between visits, but still applied now.
            }
            _renderTable();
        });
        label.append(checkbox, document.createTextNode(column.label));
        container.append(label);
    }
}


function _isColumnVisible(column: Column): boolean {
    if (column.key === "name") {
        return true;
    }
    return dashboardState.columnVisibility[column.key] ?? !column.defaultHidden;
}


function _visibleColumns(): Column[] {
    return COLUMNS.filter(_isColumnVisible);
}


function _gameCell(row: DashboardRow): HTMLElement {
    const cell = makeElement("div", "game-cell");
    if (row.game.headerImage !== "") {
        const image = document.createElement("img");
        image.src = row.game.headerImage;
        image.alt = "";
        cell.append(image);
    }
    const text = makeElement("div");
    const link = makeElement("a", "", row.game.name) as HTMLAnchorElement;
    link.href = `https://store.steampowered.com/app/${row.game.appId}/`;
    link.target = "_blank";
    link.rel = "noopener";
    text.append(link);
    const meta = [row.game.genres.slice(0, 3).join(", "), row.estimate?.confidence ? `${row.estimate.confidence} confidence` : "No estimate"]
        .filter((part) => part !== "")
        .join(" · ");
    text.append(makeElement("div", "muted small", meta));
    cell.append(text);
    return cell;
}


function _exportCsv(): void {
    const header = [
        "App ID", "Name", "Genres", "Release date", "List price (USD)", "Reviews", "Positive %",
        "Copies low", "Copies high", "Gross low", "Gross high", "Net low", "Net high",
        "Gross per month low", "Gross per month high", "Confidence",
        "Page to launch (months)", "Early Access (months)", "Scope", "Scope score",
        "Languages", "Voiced languages", "Achievements", "Multiplayer", "Separate publisher", "Install size (GB)",
        "Tracked at",
    ];
    const lines = [header];
    for (const row of dashboardState.rows) {
        const estimate = row.estimate;
        const range = (value: EstimateRange | null | undefined): string[] => value
            ? [String(Math.round(value.low)), String(Math.round(value.high))]
            : ["", ""];
        lines.push([
            row.game.appId,
            row.game.name,
            row.game.genres.join("; "),
            row.game.releaseDate?.toISOString().slice(0, 10) ?? "",
            row.game.listPriceCents === null ? "" : (row.game.listPriceCents / 100).toFixed(2),
            String(row.game.totalReviews),
            row.game.positivePercent === null ? "" : String(row.game.positivePercent),
            ...range(estimate?.copies),
            ...range(estimate?.gross),
            ...range(estimate?.net),
            ...range(estimate?.monthlyGross),
            estimate?.confidence ?? "",
            ..._productionCells(row.game),
            row.trackedAt.toISOString(),
        ]);
    }
    const csv = lines.map((line) => line.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = `steam-revenue-estimates-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
}


function _productionCells(game: GameData): string[] {
    const devTime = estimateDevTime(game);
    const scope = rateScope(game);
    const info = game.production;
    const optional = (value: number | boolean | null | undefined): string => value === null || value === undefined ? "" : String(value);
    return [
        devTime === null ? "" : devTime.pageToLaunchMonths.toFixed(1),
        devTime?.earlyAccessMonths == null ? "" : devTime.earlyAccessMonths.toFixed(1),
        scope?.level ?? "",
        optional(scope?.score),
        optional(info?.languages),
        optional(info?.fullAudioLanguages),
        optional(info?.achievements),
        optional(info?.multiplayer),
        optional(info?.separatePublisher),
        info?.storageGb == null ? "" : info.storageGb.toFixed(1),
    ];
}


function _metricColumn(metric: Metric, label: string): Column {
    const format = metric === "copies" ? countFormat : moneyFormat;
    return {
        key: metric,
        label,
        numeric: true,
        sortValue: (row) => {
            const range = _metricRange(row, metric);
            return range === null ? -1 : (range.low + range.high) / 2;
        },
        render: (row) => {
            const range = _metricRange(row, metric);
            return range === null ? "—" : formatRange(range, format);
        },
    };
}


function _metricRange(row: DashboardRow, metric: Metric): EstimateRange | null {
    if (row.estimate === null) {
        return null;
    }
    return row.estimate[metric];
}


function _tile(label: string, value: string): HTMLElement {
    const tile = makeElement("div", "card tile");
    tile.append(makeElement("div", "tile-label", label), makeElement("div", "tile-value", value));
    return tile;
}


function _truncate(text: string, maxLength: number): string {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}


function _svg(tag: string, attributes: Record<string, string | number>): SVGElement {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, String(value));
    }
    return element;
}
