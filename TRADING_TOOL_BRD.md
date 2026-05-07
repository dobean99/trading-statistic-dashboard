# BRD / Prompt: Trading Statistics Dashboard

## Overview

Build a **single-page React application** (one `.jsx` file, no backend) that lets a trader upload a CSV from **any broker** (Exness, Binance, MetaTrader, IC Markets, XM, cTrader, etc.), map columns interactively, clean the data, then provides a full statistical breakdown with interactive charts and **AI-powered insights via the Anthropic API**.

The app should feel like a professional trading analytics dashboard — clean, dark-themed, data-dense but readable.

---

## Tech Stack (all available, no install needed)

- **React** with hooks (`useState`, `useMemo`, `useCallback`)
- **Recharts** for all charts (line, bar, scatter, pie, composed)
- **Papaparse** for CSV parsing
- **Lodash** for data aggregation (`groupBy`, `sumBy`, `meanBy`, `sortBy`, `countBy`)
- **Tailwind CSS** for styling (utility classes only, no compiler — use pre-defined classes)
- **Lucide React** for icons
- **Anthropic API** (`https://api.anthropic.com/v1/messages`) for AI-powered insights (no API key needed — it's handled automatically)
- Export as a single `.jsx` file with default export

---

## App Flow (3 Steps)

The app has a clear step-by-step flow before showing the dashboard:

```
Step 1: Upload CSV
    ↓
Step 2: Column Mapping (interactive UI)
    ↓
Step 3: Data Cleaning Summary + Confirm
    ↓
Dashboard (7 tabs)
```

The user must complete each step before proceeding. Show a stepper/progress bar at the top.

---

## Step 1: Upload CSV

- Centered file upload area with drag-and-drop support
- Accept `.csv` files only
- Parse with Papaparse: `{ header: true, skipEmptyLines: true, dynamicTyping: false }`
- After parsing, extract all column headers and show a preview of the first 5 rows in a mini table
- Also show: file name, row count, column count
- Button: "Load Sample Data" to skip upload and use generated mock data (see Sample Data section)
- Button: "Next → Map Columns"

---

## Step 2: Column Mapping (CRITICAL — this makes the tool universal)

### Purpose

Different brokers export CSVs with different column names. This step lets the user tell the app which of their columns maps to which required field.

### Internal Normalized Schema

The app works internally with this normalized schema:

| Internal Field | Required? | Type | Description |
|---|---|---|---|
| `ticket` | Optional | string/int | Trade ID |
| `open_time` | **Required** | datetime | When the trade was opened |
| `close_time` | **Required** | datetime | When the trade was closed |
| `type` | Optional | string | buy/sell/long/short |
| `lots` | Optional | number | Position size / lot size / quantity |
| `symbol` | **Required** | string | Trading instrument |
| `open_price` | Optional | number | Entry price |
| `close_price` | Optional | number | Exit price |
| `stop_loss` | Optional | number | SL price |
| `take_profit` | Optional | number | TP price |
| `commission` | Optional | number | Commission/fees |
| `swap` | Optional | number | Swap/overnight fees |
| `pnl` | **Required** | number | Profit/Loss (the most important column) |
| `close_reason` | Optional | string | Why closed: tp, sl, user, so, etc. |

### Auto-Detection Logic

When the user arrives at Step 2, the app should **auto-detect** column mappings using fuzzy matching on column headers. Match rules (case-insensitive, ignore underscores/spaces/hyphens):

```
ticket       ← ticket, order, order_id, trade_id, id, position_id, deal
open_time    ← opening_time_utc, open_time, entry_time, open_date, date_open, time_open, entry_date
close_time   ← closing_time_utc, close_time, exit_time, close_date, date_close, time_close, exit_date
type         ← type, side, direction, action, buy_sell, order_type
lots         ← lots, volume, lot_size, quantity, size, amount, original_position_size
symbol       ← symbol, pair, instrument, market, ticker, asset
open_price   ← opening_price, open_price, entry_price, price_open, buy_price
close_price  ← closing_price, close_price, exit_price, price_close, sell_price
stop_loss    ← stop_loss, sl, s_l, stoploss
take_profit  ← take_profit, tp, t_p, takeprofit
commission   ← commission, fee, fees, trading_fee
swap         ← swap, rollover, overnight, financing, funding
pnl          ← profit, pnl, p_l, net_profit, realized_pnl, realised_pnl, gain_loss, result, net_pnl
close_reason ← close_reason, reason, exit_reason, close_type, exit_type, comment
```

### Mapping UI

Display a two-column layout:

| Your Column (from CSV) | Maps To | Preview |
|---|---|---|
| `opening_time_utc` | [dropdown: open_time ▼] ✅ auto-detected | `2026-05-05T23:47:24` |
| `closing_time_utc` | [dropdown: close_time ▼] ✅ auto-detected | `2026-05-05T23:49:26` |
| `profit` | [dropdown: pnl ▼] ✅ auto-detected | `-85.2` |
| `equity` | [dropdown: — skip — ▼] | `` |
| ... | ... | ... |

- Each CSV column gets a dropdown with options: all internal fields + "— skip —"
- Auto-detected mappings are pre-selected with a green checkmark
- User can override any mapping
- Show a sample value from row 1 as preview for each column
- **Validation**: Highlight required fields (`open_time`, `close_time`, `symbol`, `pnl`) — if any are unmapped, show a red warning and disable "Next"
- Unmapped optional fields are fine — the dashboard adapts (e.g., no close_reason = no Close Reason tab)
- Button: "← Back" and "Next → Clean Data"

### Known Broker Presets (optional enhancement)

If the column headers exactly match a known broker format, show a banner: "Detected: Exness format — columns auto-mapped" and skip requiring user confirmation (but still allow editing).

Known formats:

- **Exness**: `ticket, opening_time_utc, closing_time_utc, type, lots, original_position_size, symbol, opening_price, closing_price, stop_loss, take_profit, commission, swap, profit, equity, margin_level, close_reason`
- **MetaTrader 4/5**: `Order, Open Time, Close Time, Type, Size, Symbol, Open Price, Close Price, Commission, Swap, Profit`
- **Binance**: `Symbol, Side, Qty, Entry Price, Exit Price, Realized Profit, Time`

---

## Step 3: Data Cleaning & Confirmation

After mapping, the app processes the data and shows a cleaning report:

### Cleaning Pipeline

1. **Rename columns** according to mappings, drop skipped columns
2. **Parse dates**: Try ISO format first, then common formats (`MM/DD/YYYY HH:mm`, `DD.MM.YYYY HH:mm:ss`, `YYYY/MM/DD`, Unix timestamps). If a date column fails to parse >50% of rows, show a warning with a sample value and ask user to specify the format
3. **Coerce numbers**: Strip `$`, `,`, spaces from numeric fields. Convert to float. Handle negative formats like `(123.45)` → `-123.45`
4. **Normalize type**: Map variations to `buy`/`sell` (e.g., `long`→`buy`, `short`→`sell`, `BUY`→`buy`)
5. **Normalize close_reason**: Map to lowercase. Recognized values: `tp`, `sl`, `user`, `so`. Anything else → keep as-is
6. **Drop invalid rows**: Rows where `pnl` is NaN or both dates are invalid
7. **Calculate derived fields**:
   - `net_pnl = pnl - abs(commission || 0) - abs(swap || 0)`
   - `hold_time_ms = close_time - open_time`
   - `hold_time_hours = hold_time_ms / 3600000`
8. **Sort** by `close_time` ascending

### Cleaning Report UI

Show a card-based summary:

```
✅ Successfully loaded: 3,588 trades
⚠️ Dropped: 0 invalid rows
📅 Date range: Mar 1, 2026 – May 5, 2026
📊 Symbols found: XAUUSDc (3,228), BTCUSDc (343), XAGUSDc (17)
💰 PnL range: -$1,375.10 to +$1,204.80
📋 Close reasons: user (1,971), sl (1,316), tp (229), so (72)
⚠️ Optional fields missing: commission, swap (net_pnl = pnl)
```

- If `close_reason` column was not mapped → show warning: "Close Reason not available — Close Reason Analysis tab will be hidden"
- If rows were dropped, show a collapsible section listing the dropped rows
- Button: "← Back to Mapping" and "Launch Dashboard →"

---

## Dashboard Layout

- **Top bar**: App title + "Import New File" button (resets to Step 1) + current file name
- **Summary banner**: Date range, total trades, net PnL, win rate (quick stats)
- **Tab navigation**: **Overview** | **Close Reason Analysis** (hidden if no close_reason) | **Trading Sessions** | **Stop Out Analysis** (hidden if no `so` trades) | **Time Analysis** | **Trade Log** | **AI Insights**
- Dark theme

---

## Tab 1: Overview (Core Metrics + Charts)

### Metric Cards (grid layout, 4 columns desktop, 2 columns mobile)

| Metric | Formula | Format |
|---|---|---|
| Total Trades | count of all trades | integer |
| Winning Trades | count where `pnl > 0` | integer |
| Losing Trades | count where `pnl < 0` | integer |
| Break Even | count where `pnl == 0` | integer |
| Win Rate | `wins / total * 100` | percentage, 1 decimal |
| Net PnL | sum of `net_pnl` | currency, 2 decimals, green/red |
| Gross Profit | sum of `net_pnl` where > 0 | currency |
| Gross Loss | sum of `net_pnl` where < 0 | currency |
| Profit Factor | `abs(gross_profit / gross_loss)` | ratio, 2 decimals |
| Average Win | mean of winning `net_pnl` | currency |
| Average Loss | mean of losing `net_pnl` | currency |
| Reward:Risk Ratio | `abs(avg_win / avg_loss)` | ratio, 2 decimals |
| Largest Win | max `net_pnl` | currency |
| Largest Loss | min `net_pnl` | currency |
| Expectancy | `(win_rate/100 * avg_win) + (loss_rate/100 * avg_loss)` | currency |
| Max Consecutive Wins | longest streak of wins | integer |
| Max Consecutive Losses | longest streak of losses | integer |
| Avg Trade Duration | mean of hold times | formatted as hours/minutes |

### Charts in Overview Tab

1. **Cumulative PnL Line Chart**
   - X-axis: trade number (chronological order by `close_time`)
   - Y-axis: running total of `net_pnl`
   - Line color: green if final PnL > 0, red if < 0
   - Add a zero reference line (dashed gray)
   - Tooltip: trade #, cumulative PnL, individual trade PnL, symbol
   - For large datasets (>500 trades): thin line, no dots on data points

2. **PnL Distribution Histogram**
   - Bucket trades by PnL value into ~20 bins
   - Green bars for positive bins, red bars for negative
   - Show mean and median as vertical reference lines

3. **Performance by Symbol (Horizontal Bar Chart)**
   - Group by `symbol`
   - Show: total PnL per symbol, trade count, and win rate
   - Green bars for net positive, red for net negative

---

## Tab 2: Close Reason Analysis (hidden if close_reason not mapped)

### Per close_reason group, calculate

- Trade count + percentage of total
- Win rate (%)
- Total PnL
- Average PnL per trade
- Average Win / Average Loss
- Profit Factor
- Avg hold time

### Display

1. **Summary Table**: Styled table with all groups, conditional coloring
2. **Win Rate Comparison (Bar Chart)**: Per close reason, with overall win rate reference line
3. **PnL Breakdown (Grouped Bar Chart)**: Gross profit vs gross loss per close reason
4. **Trade Distribution (Donut Chart)**: Count by close reason
5. **Avg Hold Time by Close Reason (Bar Chart)**

---

## Tab 3: Trading Session Analysis

### Purpose

Analyze performance broken down by the 4 major forex/commodity trading sessions. This reveals which market session the trader performs best/worst in, and whether they should focus or avoid certain sessions.

### Session Definitions (based on `open_time` UTC)

| Session | UTC Hours | Description |
|---|---|---|
| Sydney | 21:00 – 06:00 | AUD pairs, low volatility |
| Tokyo (Asian) | 00:00 – 09:00 | JPY pairs, moderate volatility |
| London (European) | 07:00 – 16:00 | Major pairs, high volatility |
| New York (US) | 13:00 – 22:00 | USD pairs, highest volume |

**Note**: Sessions overlap — a trade opened at 08:00 UTC falls in both Tokyo and London. Assign each trade to its **primary session** using this priority logic:

1. If `open_time` is 13:00–16:00 → **London/NY Overlap** (treat as its own category — most volatile period)
2. If `open_time` is 07:00–12:59 → **London**
3. If `open_time` is 16:01–21:59 → **New York**
4. If `open_time` is 00:00–06:59 → **Tokyo**
5. If `open_time` is 22:00–23:59 or 21:00–23:59 → **Sydney**

This gives 5 non-overlapping session buckets: **Sydney**, **Tokyo**, **London**, **London/NY Overlap**, **New York**

### Per-Session Metrics

For each session calculate:

- Trade count + percentage of total
- Win rate (%)
- Total PnL
- Average PnL per trade
- Gross Profit / Gross Loss
- Profit Factor
- Average Win / Average Loss
- R:R Ratio
- Largest Win / Largest Loss
- Avg hold time of trades opened in that session

### Charts & Display

1. **Session Performance Summary Table**
   - Rows: each session
   - Columns: all metrics above
   - Conditional coloring: green for profitable sessions, red for unprofitable
   - Highlight the best and worst session rows

2. **PnL by Session (Bar Chart)**
   - Total PnL per session, green/red bars
   - Add trade count labels on each bar

3. **Win Rate by Session (Bar Chart)**
   - Win rate per session with overall win rate reference line
   - Color bars that beat the average in green, below average in red/amber

4. **Session Distribution (Donut Chart)**
   - Proportion of trades in each session

5. **Cumulative PnL by Session (Multi-Line Chart)**
   - One line per session (different colors), showing cumulative PnL over time
   - X-axis: trade number (within that session), Y-axis: cumulative PnL
   - This reveals if a session is consistently profitable or has a downward trend

6. **Session × Symbol Heatmap/Table**
   - Rows: sessions, Columns: symbols
   - Cell value: total PnL (colored green/red) or win rate
   - Reveals which instrument works best in which session (e.g., XAUUSD profitable in London but not Tokyo)

7. **Session × Close Reason Breakdown** (if close_reason available)
   - For each session: what % of trades are closed by tp, sl, user, so
   - Stacked bar chart or table
   - Reveals if the trader uses different exit strategies across sessions

### Auto-Generated Insights (via AI)

Use the "🤖 Analyze This" per-tab AI button pattern. Send session metrics to the API with prompt:

```
Analyze this trader's performance across trading sessions. Data:
{session metrics table}
Identify: which session is most/least profitable, whether the trader should avoid any session, if there are session-symbol patterns worth exploiting, and whether their exit strategy changes by session.
```

---

## Tab 4: Stop Out (SO) Event Analysis (hidden if no `so` trades exist)

### Purpose

Stop Out events (close_reason = `so`) are margin calls — the broker forcefully closes positions because the account margin level dropped too low. These are the most dangerous events in trading. This tab deep-dives into every SO event to help the trader understand what went wrong and prevent future occurrences.

### SO Event Detection & Grouping

SO events often happen in **clusters** — when margin drops, the broker liquidates multiple positions within seconds or minutes. Group SO trades into **SO Events** using this logic:

1. Filter all trades where `close_reason == "so"`
2. Sort by `close_time` ascending
3. Group consecutive SO trades that closed **within 60 seconds of each other** into a single "SO Event"
4. Each SO Event gets: event ID (SO-1, SO-2, ...), start time, end time, list of trades, total loss

### SO Event Summary Cards

For each SO Event, show a card:

```
🔴 SO Event #1 — Mar 15, 2026, 14:32 UTC
├── Trades liquidated: 5
├── Total loss: -$2,847.30
├── Symbols: XAUUSDc (3), BTCUSDc (2)
├── Positions: 3 buy, 2 sell
├── Total lots: 1.5
├── Duration: 12 seconds (first to last close)
├── Trades open before SO: [show count of trades that were open at the time]
└── Largest single loss: -$1,375.10 (ticket #1234567)
```

### Aggregate SO Metrics

| Metric | Formula | Format |
|---|---|---|
| Total SO Events | count of SO event groups | integer |
| Total SO Trades | count where close_reason = so | integer |
| Total SO Loss | sum of PnL for SO trades | currency, red |
| SO Loss as % of Total Losses | `abs(so_loss) / abs(total_losses) * 100` | percentage |
| Avg Loss per SO Event | total SO loss / event count | currency |
| Avg Trades per SO Event | SO trades / event count | ratio |
| Worst SO Event | largest total loss event | currency + date |
| SO Frequency | events per month or per X trades | ratio |

### Charts & Analysis

1. **SO Event Timeline (Scatter/Bar Chart)**
   - X-axis: date
   - Y-axis: total loss of each SO event (negative, red bars)
   - Show all trades as background context (small gray dots) with SO events as large red markers
   - This shows when blowups happened in the trading timeline

2. **SO Events on Cumulative PnL (Line Chart with Markers)**
   - Reuse the cumulative PnL line from Overview
   - Overlay red vertical bands or markers at each SO event
   - Visually shows how much each SO event set back the equity curve

3. **Pre-SO Pattern Analysis**
   - For each SO event, look at the **20 trades immediately before** the SO event
   - Calculate: win rate of those 20 trades, avg PnL, number of consecutive losses
   - Display as a table: "What happened before each SO?"
   - This reveals if SO events are preceded by tilt/revenge trading patterns

4. **SO by Session (Bar Chart)**
   - Which trading session do SO events occur in?
   - Bar chart: count of SO events per session

5. **SO by Symbol (Bar Chart)**
   - Which symbols are involved in SO events?
   - Total SO loss per symbol

6. **Position Size at SO (Table)**
   - For each SO event, show the total open lots at the time of liquidation
   - Compare to the trader's average position size
   - Flag if SO events correlate with oversized positions

7. **Recovery Analysis**
   - After each SO event, how many trades / how much time did it take to recover the lost amount?
   - Table: SO Event → Loss → Trades to recover → Days to recover → Recovered? (yes/no)
   - If recovery never happened (cumulative PnL never returned to pre-SO level), mark as "Not recovered"

### Auto-Generated Insights (via AI)

Use the "🤖 Analyze This" per-tab AI button. Send SO event data to the API with prompt:

```
Analyze this trader's Stop Out (margin call) events. A stop out means the broker liquidated positions due to insufficient margin.

## SO Summary
- Total SO events: {count}
- Total SO loss: ${total}
- SO loss as % of all losses: {pct}%
- Average trades per SO event: {avg}

## Individual SO Events
{for each event: date, trade count, loss, symbols involved, lots}

## Pre-SO Patterns
{for each event: win rate of 20 trades before, avg PnL before, consecutive losses before}

## Recovery
{for each event: loss amount, trades to recover, days to recover, recovered yes/no}

Provide:
1. Root cause analysis — what's causing the stop outs? (over-leveraging, revenge trading, correlated positions, news events?)
2. Pattern detection — do SO events follow losing streaks? Are they concentrated in specific sessions or symbols?
3. Position sizing critique — is the trader using appropriate lot sizes relative to their account?
4. Specific prevention plan — 3-5 concrete rules the trader should implement to avoid future SO events
5. Severity assessment — how damaging are these SOs to overall performance? What would the PnL look like without them?

Be brutally honest. Stop outs are serious risk management failures.
```

---

## Tab 5: Time Analysis (Frequency & Hold Time)

### Hold Time Categories

- `< 5min`: Scalping
- `5min - 1h`: Short-term
- `1h - 4h`: Intraday
- `4h - 24h`: Day trade
- `1d - 7d`: Swing
- `> 7d`: Position

### Charts

1. **Hold Time Distribution (Stacked Bar)**: By category, stacked win/loss
2. **Hold Time vs PnL (Scatter Plot)**: X=hours, Y=PnL, green/red dots. Small radius (r=3), opacity 0.6 for large datasets
3. **Trades by Day of Week (ComposedChart)**: Bars for count + line for avg PnL
4. **Trades by Hour of Day (ComposedChart)**: Bars for count + line for avg PnL (UTC hours 0-23)
5. **Hold Time Stats Table**: Per category stats

---

## Tab 6: Trade Log

- Sortable, filterable, paginated table of all trades
- **Columns**: #, Ticket, Open Time, Close Time, Symbol, Type, Lots, Open Price, Close Price, SL, TP, PnL, Net PnL, Hold Time, Close Reason
- Columns adapt based on what was mapped (e.g., if no `lots` mapped, hide that column)
- PnL colored green/red, Type as colored badges, Close Reason as colored badges
- Filters: Symbol, Type, Close Reason dropdowns
- Search by ticket number
- Sort by clicking headers
- Pagination: 50 per page
- Footer summary: total PnL and count for current filter

---

## Tab 7: AI Insights (Anthropic API Integration)

### Purpose

This tab sends the calculated metrics + aggregated data to Claude via the Anthropic API and displays AI-generated trading insights, advice, and pattern analysis.

### Implementation

```javascript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }]
  })
});
const data = await response.json();
const aiText = data.content.map(item => item.text || "").join("\n");
```

### What to Send (NOT raw trades — send aggregated metrics only)

Build a structured prompt containing:

```
You are an expert trading analyst. Analyze this trader's performance data and provide actionable insights.

## Core Metrics
- Total Trades: {total}
- Win Rate: {winRate}%
- Net PnL: ${netPnl}
- Profit Factor: {profitFactor}
- Avg Win: ${avgWin} | Avg Loss: ${avgLoss}
- R:R Ratio: {rrRatio}
- Expectancy: ${expectancy}
- Max Consecutive Wins: {maxConsWins} | Losses: {maxConsLosses}

## Performance by Symbol
{for each symbol: name, count, winRate, totalPnl, avgPnl}

## Close Reason Breakdown
{for each reason: name, count, winRate, totalPnl, avgPnl, avgWin, avgLoss}

## Trading Session Performance
{for each session (Sydney, Tokyo, London, London/NY Overlap, New York): count, winRate, totalPnl, avgPnl, profitFactor}

## Stop Out Events
- Total SO events: {count} (clustered groups)
- Total SO loss: ${soLoss}
- SO loss as % of all losses: {soPct}%
- Worst single SO event: ${worstSoLoss} on {date}
- Pre-SO patterns: {avg consecutive losses before SO, avg win rate of 20 trades before}

## Time Analysis
- Most active hours (UTC): {top 3 hours by trade count, with avg PnL each}
- Most active days: {top 3 days by count, with avg PnL each}
- Best performing hold time category: {category, winRate, avgPnl}
- Worst performing hold time category: {category, winRate, avgPnl}

## Equity Curve Shape
- Starting cumulative PnL trend (first 25% of trades): {up/down/flat, total PnL}
- Middle period (25-75%): {up/down/flat, total PnL}
- Recent period (last 25%): {up/down/flat, total PnL}

Please provide:
1. **Overall Assessment**: Is this trader profitable? What's the trading style? (2-3 sentences)
2. **Top 3 Strengths**: What's working well, backed by the numbers
3. **Top 3 Weaknesses**: What needs improvement, backed by the numbers
4. **Close Reason Analysis**: Are stop losses too tight/wide? Are manual closes helping or hurting? Is TP optimized?
5. **Session Analysis**: Which sessions should the trader focus on? Which should they avoid? Any session-symbol edges?
6. **Stop Out Risk Assessment**: How severe is the SO problem? What's causing them? What rules should be implemented?
7. **Time-Based Patterns**: Any session/day advantages? Should the trader avoid certain times?
8. **Risk Management Score** (1-10): Based on R:R, profit factor, max consecutive losses, stop-out frequency, position sizing
9. **Specific Actionable Recommendations**: 5-7 concrete things the trader should do differently, prioritized by impact

Format your response in clear sections with headers. Be direct and specific — reference the actual numbers. Do not be generic. If something is bad, say it clearly.
```

### AI Insights UI

- "Generate AI Analysis" button (don't auto-trigger — user clicks when ready)
- Show loading state with a spinner and "Analyzing your trading data..."
- Display the AI response in a styled card with proper markdown rendering:
  - Headers as styled section dividers
  - Bold text for emphasis
  - Numbers highlighted
- "Regenerate" button to get fresh analysis
- Error handling: if API fails, show a friendly error with retry button

### Additional AI Features

1. **Ask Follow-up**: Below the analysis, show a text input where the user can ask specific questions about their data. The app sends the same metrics context + the user's question to the API.

2. **Per-Tab AI Button**: On each tab (Overview, Close Reason, Trading Sessions, Stop Out, Time Analysis), add a small "🤖 Analyze This" button that sends only that tab's specific metrics to the API for a focused analysis. For example:
   - On Close Reason tab: "Analyze my close reason patterns — am I closing trades correctly?"
   - On Trading Sessions tab: "Analyze my session performance — which sessions should I focus on?"
   - On Stop Out tab: "Analyze my stop out events — what's causing them and how do I prevent them?"
   - On Time tab: "Analyze my trading schedule — when should I trade and when should I avoid?"

---

## Sample Data Generator

Include a button **"Load Sample Data"** that generates ~80 mock trades with the normalized internal schema so the user can explore without uploading. The sample should include:

- Mix of symbols (XAUUSD, BTCUSD, EURUSD)
- Close reasons: ~50% user, ~30% sl, ~15% tp, ~5% so
- PnL range: -$500 to +$400
- Hold times from 2 minutes to 3 days
- Dates over 1 month
- Realistic prices per instrument

---

## UI/UX Requirements

- **Dark theme**: Background `#0f172a`, cards `#1e293b`, borders `#334155`
- **Profit green**: `#22c55e`
- **Loss red**: `#ef4444`
- **Accent blue**: `#3b82f6`
- **Amber/yellow**: `#f59e0b` for warnings
- **Text**: White primary, `#94a3b8` secondary
- **Responsive**: 4-col grid desktop, 2-col smaller
- **Loading states**: Spinners for CSV parsing and AI API calls
- **Empty state**: Upload prompt with supported broker examples
- **Number formatting**: `$1,234.56` with commas
- **Stepper UI**: Steps 1-2-3 progress indicator during import flow
- **Chart tooltips**: Informative on all charts
- **Tab indicator**: Active tab highlighted

---

## Performance Considerations

- Datasets may have **3,000-10,000+ trades** — all calculations MUST use `useMemo`
- Scatter plots with many points: small dots (r=3), opacity 0.6
- Cumulative PnL: thin line, no point markers for >500 trades
- Trade log: paginate at 50 rows, never render all at once
- AI API calls: debounce, show loading, cache responses in state

---

## Non-Functional Requirements

- Everything in a **single `.jsx` file** with default export
- **No `localStorage` or `sessionStorage`** — React state only
- **No `<form>` tags** — use `onClick` / `onChange` handlers
- Only external call allowed: `https://api.anthropic.com/v1/messages`
- Handle edge cases: empty CSV, single trade, all wins, all losses, missing optional columns
- Dashboard tabs adapt to available data (hide Close Reason tab if not mapped, hide Stop Out tab if no SO trades, hide Trading Sessions tab if no open_time available)
- All chart colors consistent with theme

---

## File Structure

```text
trading-dashboard.jsx    # The entire application
```

One file. Ready to render.

---

## Implementation Status

Built. Single-file deliverable: [trading-dashboard.jsx](trading-dashboard.jsx) (≈2.3k lines, default-exported `TradingDashboardApp`). Wrapped in a minimal Vite shell so it can run locally — the `.jsx` itself stays at the repo root and is unchanged.

### Shell files (additive — none modify the deliverable)

- [package.json](package.json), [vite.config.js](vite.config.js)
- [index.html](index.html) — Vite entry; loads Tailwind via the CDN runtime (`cdn.tailwindcss.com`), matching the spec's "no compiler — use pre-defined classes" rule
- [src/main.jsx](src/main.jsx) — 7-line bootstrap that imports `TradingDashboardApp` from the root file

### Run locally

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/
npm run preview  # serve dist/
```

### Notes on host integration

- **Anthropic API**: the call to `https://api.anthropic.com/v1/messages` assumes a host that injects auth (per §AI Insights). Running directly from `npm run dev` will fail CORS / 401. Sample data and every non-AI tab work without any host. To exercise the AI tabs locally, add a proxy server with your key.
- **Model in use**: `claude-sonnet-4-20250514` per §"Tab 7" code block. Bump as desired.
- **Single-file rule preserved**: the shell only imports `TradingDashboardApp`; it never modifies, splits, or wraps the deliverable beyond rendering it into `#root`.
