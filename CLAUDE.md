# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository State

Implemented. The app is a single file: [trading-dashboard.jsx](trading-dashboard.jsx) (≈2.3k lines, default-exported `TradingDashboardApp`). Around it is a minimal Vite shell:

- [package.json](package.json), [vite.config.js](vite.config.js)
- [index.html](index.html) — Vite entry; loads Tailwind via the CDN runtime (`cdn.tailwindcss.com`) per the BRD's "no compiler" rule
- [src/main.jsx](src/main.jsx) — 7-line bootstrap that imports `TradingDashboardApp` from the root file
- [TRADING_TOOL_BRD.md](TRADING_TOOL_BRD.md) — original spec, source of truth for behavior

`trading-dashboard.jsx` is the deliverable and stays at the repo root, untouched by tooling. Don't move it into `src/` and don't split it.

## Commands

```sh
npm install
npm run dev       # http://localhost:5173 (auto-opens)
npm run build     # → dist/
npm run preview   # serve dist/
```

There is no test suite, lint config, or typecheck step. Verification = `npm run build` (Babel/Vite parse) plus visual smoke testing via `npm run dev`.

## Hard Constraints (from BRD — easy to violate)

- **Single `.jsx` file** with default export. No multi-file split, no extracted modules — keep all React components and helpers inline in `trading-dashboard.jsx`.
- **React state only** — no `localStorage` / `sessionStorage`.
- **No `<form>` tags** — wire interactions via `onClick` / `onChange`.
- **Only outbound runtime call permitted**: `https://api.anthropic.com/v1/messages` (no API key in code; the spec assumes a host that injects auth — calling this from a normal browser dev server will fail CORS / 401).
- Send **aggregated metrics** to the Anthropic API, never raw trade rows.
- Datasets reach **3k–10k+ trades** — every derived value goes through `useMemo`; trade log paginates at 50; cumulative-PnL line drops point markers above 500 trades; scatter plots use `r=3, opacity 0.6`.

## Architecture: The Normalized Schema is the Spine

The app's universality comes from one design choice: every broker CSV is funnelled through a fixed internal schema before any analytics run. Touching this contract has cascading effects.

**Internal fields** (see `INTERNAL_FIELDS` in code, BRD §"Internal Normalized Schema" for full list): `ticket, open_time, close_time, type, lots, symbol, open_price, close_price, stop_loss, take_profit, commission, swap, pnl, close_reason`. Required: `open_time, close_time, symbol, pnl`.

**Derived fields** computed during cleaning (Step 3):

- `net_pnl = pnl - abs(commission||0) - abs(swap||0)`
- `hold_time_ms`, `hold_time_hours`
- Rows sorted ascending by `close_time`

**Tabs adapt to available fields**, not the other way around:

- Close Reason tab — hidden if `close_reason` not mapped
- Stop Out tab — hidden if no trades have `close_reason == "so"`
- Trading Sessions tab — hidden if `open_time` not available
- Trade Log columns — hide unmapped optional columns (e.g., no `lots` → no Lots column)

Adding a new tab or metric: (1) decide which schema fields it requires, (2) add the conditional render guard in `Dashboard`, (3) compute via `useMemo`, (4) add a `<AnalyzeThis>` button that sends *only that tab's aggregates* to the API.

## Flow: Three Gated Steps Before the Dashboard

```text
Step 1 (Upload CSV) → Step 2 (Column Mapping) → Step 3 (Cleaning Report) → Dashboard (7 tabs)
```

Each step blocks until valid. The mapping step is the universality layer:

1. **Auto-detect** via fuzzy match on `COLUMN_ALIASES` (case-insensitive, ignore `_`/space/`-`). Keep this object in sync with BRD §"Auto-Detection Logic" when adding broker support.
2. **Broker presets** in `BROKER_PRESETS` (Exness, MetaTrader, Binance) bypass user confirmation when headers exactly match.
3. **Required-field validation** in `StepMapping` disables "Next" when any of the four required fields is unmapped or duplicated.

`cleanData()` handles date parsing fallbacks (ISO / `MM/DD/YYYY` / `DD.MM.YYYY` / `YYYY/MM/DD` / Unix), numeric coercion (`$`, `,`, `(123.45)` → `-123.45`), and `type`/`close_reason` normalization. Drop rows only when `pnl` is NaN or both dates fail.

## Trading Sessions: Non-Overlapping Buckets

Sessions overlap in reality, but `getSession()` bucketizes each trade into exactly one of five categories using a **priority order** on `open_time` UTC (implemented as minutes-since-midnight comparisons). The order matters — independent range checks would double-count overlapping hours:

1. 13:00–16:00 → London/NY Overlap
2. 07:00–12:59 → London
3. 16:01–21:59 → New York
4. 00:00–06:59 → Tokyo
5. 22:00–23:59 → Sydney

## Stop Out (SO) Event Grouping

`groupSOEvents()` clusters SO trades into "events" by closing within **60 seconds of each other** (sorted by `close_time`). One margin call typically liquidates several positions — the grouping logic is what makes the SO tab meaningful. Pre-SO pattern analysis looks at the **20 trades immediately before** each event. Recovery analysis walks the cumulative-PnL series forward until it returns to the pre-SO level.

## AI Calls

`callAnthropic(prompt)` posts to `https://api.anthropic.com/v1/messages` with model `claude-sonnet-4-20250514`. Two entry points:

- The **AI Insights tab** sends the full structured prompt + a follow-up Q&A box.
- Each data tab embeds an `<AnalyzeThis>` modal that sends only that tab's aggregates.

When changing prompts, keep the "aggregates only, never raw trades" rule.

## Theme Tokens

Dark theme. Defined in the `C` object at the top of `trading-dashboard.jsx`:

- Background `#0f172a`, cards `#1e293b`, borders `#334155`
- Profit `#22c55e`, loss `#ef4444`, accent `#3b82f6`, warning `#f59e0b`
- Text: white primary, `#94a3b8` secondary

## Tech Stack

React 18 (hooks only), Vite 5 with `@vitejs/plugin-react`, Recharts, Papaparse, Lodash, Lucide React, Tailwind via CDN runtime.
