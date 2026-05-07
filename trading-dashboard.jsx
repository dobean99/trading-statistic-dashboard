import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter, PieChart, Pie,
  ComposedChart, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import Papa from 'papaparse';
import _ from 'lodash';
import {
  Upload, FileText, AlertTriangle, CheckCircle, ChevronRight, ChevronLeft,
  TrendingUp, TrendingDown, DollarSign, Target, BarChart3, Clock,
  AlertOctagon, Brain, Sparkles, RefreshCw, Send, Filter, Search,
  ChevronUp, ChevronDown, X, FileUp, RotateCcw
} from 'lucide-react';

// ============================================================================
// Theme tokens — keep in sync with BRD §UI/UX Requirements
// ============================================================================
const C = {
  bg: '#0f172a', card: '#1e293b', cardAlt: '#0b1220', border: '#334155',
  green: '#22c55e', red: '#ef4444', blue: '#3b82f6', amber: '#f59e0b',
  purple: '#8b5cf6', pink: '#ec4899',
  text: '#f8fafc', textMuted: '#94a3b8', textDim: '#64748b',
};

const SESSIONS = ['Sydney', 'Tokyo', 'London', 'London/NY Overlap', 'New York'];
const SESSION_COLORS = {
  Sydney: C.purple, Tokyo: C.pink, London: C.green,
  'London/NY Overlap': C.amber, 'New York': C.blue,
};

const HOLD_BUCKETS = [
  { key: '<5min',     min: 0,                max: 5*60*1000,        label: 'Scalping (<5m)' },
  { key: '5min-1h',   min: 5*60*1000,        max: 60*60*1000,       label: 'Short (5m-1h)' },
  { key: '1h-4h',     min: 60*60*1000,       max: 4*60*60*1000,     label: 'Intraday (1-4h)' },
  { key: '4h-24h',    min: 4*60*60*1000,     max: 24*60*60*1000,    label: 'Day (4-24h)' },
  { key: '1d-7d',     min: 24*60*60*1000,    max: 7*24*60*60*1000,  label: 'Swing (1-7d)' },
  { key: '>7d',       min: 7*24*60*60*1000,  max: Infinity,         label: 'Position (>7d)' },
];

const INTERNAL_FIELDS = [
  { key: 'ticket',       label: 'Ticket',       required: false },
  { key: 'open_time',    label: 'Open Time',    required: true  },
  { key: 'close_time',   label: 'Close Time',   required: true  },
  { key: 'type',         label: 'Type',         required: false },
  { key: 'lots',         label: 'Lots',         required: false },
  { key: 'symbol',       label: 'Symbol',       required: true  },
  { key: 'open_price',   label: 'Open Price',   required: false },
  { key: 'close_price',  label: 'Close Price',  required: false },
  { key: 'stop_loss',    label: 'Stop Loss',    required: false },
  { key: 'take_profit',  label: 'Take Profit',  required: false },
  { key: 'commission',   label: 'Commission',   required: false },
  { key: 'swap',         label: 'Swap',         required: false },
  { key: 'pnl',          label: 'PnL',          required: true  },
  { key: 'close_reason', label: 'Close Reason', required: false },
];
const FIELDS_BY_KEY = _.keyBy(INTERNAL_FIELDS, 'key');
const REQUIRED_FIELDS = INTERNAL_FIELDS.filter(f => f.required).map(f => f.key);

// Aliases match against keys after normalization (lowercase, strip _ - space)
const COLUMN_ALIASES = {
  ticket:       ['ticket','order','orderid','tradeid','id','positionid','deal'],
  open_time:    ['openingtimeutc','opentime','entrytime','opendate','dateopen','timeopen','entrydate','time'],
  close_time:   ['closingtimeutc','closetime','exittime','closedate','dateclose','timeclose','exitdate'],
  type:         ['type','side','direction','action','buysell','ordertype'],
  lots:         ['lots','volume','lotsize','quantity','size','qty','amount','originalpositionsize'],
  symbol:       ['symbol','pair','instrument','market','ticker','asset'],
  open_price:   ['openingprice','openprice','entryprice','priceopen','buyprice'],
  close_price:  ['closingprice','closeprice','exitprice','priceclose','sellprice'],
  stop_loss:    ['stoploss','sl'],
  take_profit:  ['takeprofit','tp'],
  commission:   ['commission','fee','fees','tradingfee'],
  swap:         ['swap','rollover','overnight','financing','funding'],
  pnl:          ['profit','pnl','pl','netprofit','realizedpnl','realisedpnl','realizedprofit','gainloss','result','netpnl'],
  close_reason: ['closereason','reason','exitreason','closetype','exittype','comment'],
};

const BROKER_PRESETS = {
  Exness: ['ticket','opening_time_utc','closing_time_utc','type','lots','original_position_size','symbol','opening_price','closing_price','stop_loss','take_profit','commission','swap','profit','equity','margin_level','close_reason'],
  MetaTrader: ['Order','Open Time','Close Time','Type','Size','Symbol','Open Price','Close Price','Commission','Swap','Profit'],
  Binance: ['Symbol','Side','Qty','Entry Price','Exit Price','Realized Profit','Time'],
};

// Timezone offset presets (hours from UTC). Sessions are bucketed in UTC,
// so server-time CSVs (most MT4/5 brokers) need to be shifted before analysis.
const TIMEZONE_PRESETS = [
  { value: 0,  label: 'UTC (Binance, Exness web export)' },
  { value: 1,  label: 'GMT+1 — CET' },
  { value: 2,  label: 'GMT+2 — EET (winter), most MT4/5 brokers' },
  { value: 3,  label: 'GMT+3 — EEST (summer), IC Markets / XM / Pepperstone' },
  { value: -4, label: 'GMT-4 — EDT (US Eastern, summer)' },
  { value: -5, label: 'GMT-5 — EST (US Eastern, winter)' },
  { value: 'custom', label: 'Custom (enter offset in hours)' },
];

// ============================================================================
// Helpers
// ============================================================================
const normKey = (s) => String(s ?? '').toLowerCase().replace(/[\s_\-]/g, '');

function autoDetectMapping(csvColumns) {
  const used = new Set();
  const result = {};
  csvColumns.forEach(col => {
    const n = normKey(col);
    let best = '__skip__';
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (used.has(field)) continue;
      if (aliases.includes(n)) { best = field; break; }
    }
    if (best !== '__skip__') used.add(best);
    result[col] = best;
  });
  return result;
}

function detectBrokerPreset(csvColumns) {
  const a = csvColumns.map(normKey).sort();
  for (const [name, preset] of Object.entries(BROKER_PRESETS)) {
    const b = preset.map(normKey).sort();
    if (a.length === b.length && a.every((x, i) => x === b[i])) return name;
  }
  return null;
}

function parseDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (!s) return null;

  // ISO-ish: 2026-05-05T23:47:24[.fff][Z|+00:00] or 2026-05-05 23:47:24
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    if (!isNaN(d.getTime())) return d;
  }

  // MM/DD/YYYY [HH:mm[:ss]]
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[1]-1, +m[2], +(m[4]||0), +(m[5]||0), +(m[6]||0)));
    if (!isNaN(d.getTime())) return d;
  }

  // DD.MM.YYYY [HH:mm[:ss]]
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2]-1, +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0)));
    if (!isNaN(d.getTime())) return d;
  }

  // YYYY/MM/DD [HH:mm[:ss]]
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0)));
    if (!isNaN(d.getTime())) return d;
  }

  // Unix timestamp
  if (/^\d+$/.test(s)) {
    const n = +s;
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: native Date
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseNumber(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return value;
  let s = String(value).trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$\s,]/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return neg ? -n : n;
}

function normType(value) {
  if (value == null) return null;
  const s = String(value).toLowerCase().trim();
  if (['buy','long','b','0'].includes(s)) return 'buy';
  if (['sell','short','s','1'].includes(s)) return 'sell';
  return s || null;
}

function normReason(value) {
  if (value == null) return null;
  const s = String(value).toLowerCase().trim();
  if (!s) return null;
  if (['tp','takeprofit','take_profit','take profit'].includes(s)) return 'tp';
  if (['sl','stoploss','stop_loss','stop loss'].includes(s)) return 'sl';
  if (['user','manual','closed','close','close by user'].includes(s)) return 'user';
  if (['so','stopout','stop_out','stop out','margin call','margincall'].includes(s)) return 'so';
  return s;
}

function getSession(date) {
  if (!date) return null;
  const m = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (m >= 780  && m <= 960)  return 'London/NY Overlap'; // 13:00–16:00
  if (m >= 420  && m <= 779)  return 'London';            // 07:00–12:59
  if (m >= 961  && m <= 1319) return 'New York';          // 16:01–21:59
  if (m >= 0    && m <= 419)  return 'Tokyo';             // 00:00–06:59
  if (m >= 1320 && m <= 1439) return 'Sydney';            // 22:00–23:59
  return null;
}

function holdBucketKey(ms) {
  if (ms == null || isNaN(ms)) return null;
  for (const b of HOLD_BUCKETS) if (ms >= b.min && ms < b.max) return b.key;
  return HOLD_BUCKETS[HOLD_BUCKETS.length - 1].key;
}

const fmtCurrency = (n, decimals = 2) => {
  if (n == null || !isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
};
const fmtNumber = (n, decimals = 2) => (n == null || !isFinite(n)) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const fmtPct = (n, decimals = 1) => (n == null || !isFinite(n)) ? '—' : `${n.toFixed(decimals)}%`;
const fmtDate = (d) => !d ? '—' : d.toISOString().slice(0, 10);
const fmtDateTime = (d) => !d ? '—' : d.toISOString().replace('T', ' ').slice(0, 16);
const fmtDuration = (ms) => {
  if (ms == null || !isFinite(ms)) return '—';
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(0)}m`;
  if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`;
  return `${(ms / 86400000).toFixed(1)}d`;
};

// ============================================================================
// Cleaning pipeline
// ============================================================================
function cleanData(rawRows, mapping, tzOffsetHours = 0) {
  const inv = {};
  for (const [csvCol, field] of Object.entries(mapping)) {
    if (field && field !== '__skip__') inv[field] = csvCol;
  }

  // Sessions are computed in UTC. If the CSV is in broker server time (e.g. GMT+3),
  // subtract the offset so 12:00 GMT+3 becomes 09:00 UTC — the actual instant.
  const offsetMs = (Number(tzOffsetHours) || 0) * 3600000;

  const trades = [];
  const dropped = [];
  const dateParseStats = { open_time: { ok: 0, fail: 0 }, close_time: { ok: 0, fail: 0 } };

  rawRows.forEach((row, idx) => {
    const t = { _row: idx };

    if (inv.ticket)       t.ticket = String(row[inv.ticket] ?? '').trim();
    if (inv.symbol)       t.symbol = String(row[inv.symbol] ?? '').trim();
    if (inv.type)         t.type = normType(row[inv.type]);
    if (inv.close_reason) t.close_reason = normReason(row[inv.close_reason]);

    if (inv.open_time)  {
      t.open_time = parseDate(row[inv.open_time]);
      if (t.open_time && offsetMs) t.open_time = new Date(t.open_time.getTime() - offsetMs);
      dateParseStats.open_time[t.open_time ? 'ok' : 'fail']++;
    }
    if (inv.close_time) {
      t.close_time = parseDate(row[inv.close_time]);
      if (t.close_time && offsetMs) t.close_time = new Date(t.close_time.getTime() - offsetMs);
      dateParseStats.close_time[t.close_time ? 'ok' : 'fail']++;
    }

    ['lots','open_price','close_price','stop_loss','take_profit','commission','swap','pnl'].forEach(k => {
      if (inv[k]) t[k] = parseNumber(row[inv[k]]);
    });

    const validPnl     = inv.pnl && isFinite(t.pnl);
    const bothDatesBad = inv.open_time && inv.close_time && !t.open_time && !t.close_time;

    if (!validPnl)    { dropped.push({ idx, reason: 'pnl is not a number',     row }); return; }
    if (bothDatesBad) { dropped.push({ idx, reason: 'both dates failed to parse', row }); return; }

    const commission = isFinite(t.commission) ? t.commission : 0;
    const swap       = isFinite(t.swap) ? t.swap : 0;
    t.net_pnl = t.pnl - Math.abs(commission) - Math.abs(swap);

    if (t.open_time && t.close_time) {
      t.hold_time_ms = t.close_time.getTime() - t.open_time.getTime();
      t.hold_time_hours = t.hold_time_ms / 3600000;
    }
    trades.push(t);
  });

  trades.sort((a, b) => {
    const ta = a.close_time ? a.close_time.getTime() : 0;
    const tb = b.close_time ? b.close_time.getTime() : 0;
    return ta - tb;
  });

  const warnings = [];
  ['open_time','close_time'].forEach(k => {
    const s = dateParseStats[k];
    const total = s.ok + s.fail;
    if (total > 0 && s.fail / total > 0.5) {
      warnings.push(`${k}: ${s.fail}/${total} rows failed to parse — check the date format.`);
    }
  });

  return { trades, dropped, mapping: inv, warnings };
}

// ============================================================================
// Sample data generator (~80 trades, 1 month)
// ============================================================================
function generateSampleData() {
  const symbols = ['XAUUSDc', 'BTCUSDc', 'EURUSDc'];
  const reasonPick = () => {
    const r = Math.random();
    if (r < 0.50) return 'user';
    if (r < 0.80) return 'sl';
    if (r < 0.95) return 'tp';
    return 'so';
  };
  const now = Date.now();
  const start = now - 30 * 24 * 3600 * 1000;
  const trades = [];
  for (let i = 0; i < 80; i++) {
    const sym = symbols[Math.floor(Math.random() * symbols.length)];
    const type = Math.random() > 0.5 ? 'buy' : 'sell';
    const reason = reasonPick();
    const holdMs = (2 * 60 * 1000) + Math.random() * (3 * 24 * 3600 * 1000);
    const openT = start + Math.random() * 30 * 24 * 3600 * 1000;
    const closeT = Math.min(openT + holdMs, now);
    const pnl =
      reason === 'tp' ? (50 + Math.random() * 350) :
      reason === 'sl' ? -(50 + Math.random() * 200) :
      reason === 'so' ? -(200 + Math.random() * 300) :
      ((Math.random() > 0.45 ? 1 : -1) * (10 + Math.random() * 250));
    let openPrice;
    if (sym === 'XAUUSDc')      openPrice = 2300 + Math.random() * 200;
    else if (sym === 'BTCUSDc') openPrice = 60000 + Math.random() * 20000;
    else                        openPrice = 1.05 + Math.random() * 0.10;
    const lots = +(0.01 + Math.random() * 0.99).toFixed(2);
    const commission = -(0.3 + Math.random() * 1.5);
    const swap       = -(Math.random() * 1.2);
    const t = {
      ticket: String(1_000_000 + i),
      open_time: new Date(openT),
      close_time: new Date(closeT),
      type, lots, symbol: sym,
      open_price: +openPrice.toFixed(sym === 'EURUSDc' ? 5 : 2),
      close_price: +(openPrice + (Math.random() - 0.5) * (sym === 'EURUSDc' ? 0.005 : 50)).toFixed(sym === 'EURUSDc' ? 5 : 2),
      stop_loss: NaN, take_profit: NaN,
      commission, swap,
      pnl: +pnl.toFixed(2),
      close_reason: reason,
    };
    t.net_pnl = t.pnl - Math.abs(t.commission) - Math.abs(t.swap);
    t.hold_time_ms = t.close_time - t.open_time;
    t.hold_time_hours = t.hold_time_ms / 3600000;
    trades.push(t);
  }
  trades.sort((a, b) => a.close_time - b.close_time);
  return trades;
}

const SAMPLE_MAPPING_FOR_DISPLAY = INTERNAL_FIELDS.reduce((m, f) => {
  if (f.key !== 'stop_loss' && f.key !== 'take_profit') m[f.key] = f.key;
  return m;
}, {});

// ============================================================================
// Metric calculations
// ============================================================================
function computeCoreMetrics(trades) {
  const total = trades.length;
  const wins = trades.filter(t => t.net_pnl > 0);
  const losses = trades.filter(t => t.net_pnl < 0);
  const breakEven = trades.filter(t => t.net_pnl === 0).length;

  const grossProfit = _.sumBy(wins, 'net_pnl');
  const grossLoss   = _.sumBy(losses, 'net_pnl');
  const netPnl      = _.sumBy(trades, 'net_pnl');
  const avgWin      = wins.length ? grossProfit / wins.length : 0;
  const avgLoss     = losses.length ? grossLoss / losses.length : 0;
  const winRate     = total ? (wins.length / total) * 100 : 0;
  const lossRate    = total ? (losses.length / total) * 100 : 0;
  const profitFactor = grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : 0);
  const rrRatio     = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  const expectancy  = (winRate / 100) * avgWin + (lossRate / 100) * avgLoss;
  const largestWin  = wins.length ? _.maxBy(wins, 'net_pnl').net_pnl : 0;
  const largestLoss = losses.length ? _.minBy(losses, 'net_pnl').net_pnl : 0;

  let curWin = 0, curLoss = 0, maxWin = 0, maxLoss = 0;
  trades.forEach(t => {
    if (t.net_pnl > 0)      { curWin++; curLoss = 0; if (curWin  > maxWin)  maxWin  = curWin; }
    else if (t.net_pnl < 0) { curLoss++; curWin = 0; if (curLoss > maxLoss) maxLoss = curLoss; }
  });

  const holdMsList = trades.map(t => t.hold_time_ms).filter(x => isFinite(x));
  const avgHoldMs = holdMsList.length ? _.mean(holdMsList) : null;

  return {
    total, wins: wins.length, losses: losses.length, breakEven,
    winRate, lossRate, netPnl, grossProfit, grossLoss,
    avgWin, avgLoss, profitFactor, rrRatio, expectancy,
    largestWin, largestLoss, maxConsWins: maxWin, maxConsLosses: maxLoss,
    avgHoldMs,
  };
}

function computeBySymbol(trades) {
  const groups = _.groupBy(trades, 'symbol');
  return Object.entries(groups).map(([symbol, ts]) => {
    const wins = ts.filter(t => t.net_pnl > 0);
    return {
      symbol, count: ts.length,
      totalPnl: _.sumBy(ts, 'net_pnl'),
      avgPnl: _.meanBy(ts, 'net_pnl'),
      winRate: ts.length ? (wins.length / ts.length) * 100 : 0,
    };
  }).sort((a, b) => b.totalPnl - a.totalPnl);
}

function computeByCloseReason(trades) {
  const groups = _.groupBy(trades.filter(t => t.close_reason), 'close_reason');
  const total = trades.length;
  return Object.entries(groups).map(([reason, ts]) => {
    const wins = ts.filter(t => t.net_pnl > 0);
    const losses = ts.filter(t => t.net_pnl < 0);
    const grossProfit = _.sumBy(wins, 'net_pnl');
    const grossLoss   = _.sumBy(losses, 'net_pnl');
    const holdList = ts.map(t => t.hold_time_ms).filter(x => isFinite(x));
    return {
      reason, count: ts.length,
      pct: total ? (ts.length / total) * 100 : 0,
      winRate: ts.length ? (wins.length / ts.length) * 100 : 0,
      totalPnl: _.sumBy(ts, 'net_pnl'),
      avgPnl: _.meanBy(ts, 'net_pnl'),
      avgWin: wins.length ? grossProfit / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      grossProfit, grossLoss,
      profitFactor: grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : 0),
      avgHoldMs: holdList.length ? _.mean(holdList) : null,
    };
  }).sort((a, b) => b.count - a.count);
}

function computeBySession(trades) {
  const tagged = trades.map(t => ({ ...t, _session: getSession(t.open_time) })).filter(t => t._session);
  const groups = _.groupBy(tagged, '_session');
  const total = tagged.length;
  return SESSIONS.map(session => {
    const ts = groups[session] || [];
    const wins = ts.filter(t => t.net_pnl > 0);
    const losses = ts.filter(t => t.net_pnl < 0);
    const grossProfit = _.sumBy(wins, 'net_pnl');
    const grossLoss   = _.sumBy(losses, 'net_pnl');
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const holdList = ts.map(t => t.hold_time_ms).filter(x => isFinite(x));
    return {
      session, count: ts.length,
      pct: total ? (ts.length / total) * 100 : 0,
      winRate: ts.length ? (wins.length / ts.length) * 100 : 0,
      totalPnl: _.sumBy(ts, 'net_pnl'),
      avgPnl: ts.length ? _.meanBy(ts, 'net_pnl') : 0,
      grossProfit, grossLoss,
      profitFactor: grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : (grossProfit > 0 ? Infinity : 0),
      avgWin, avgLoss,
      rrRatio: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0,
      largestWin:  wins.length   ? _.maxBy(wins, 'net_pnl').net_pnl    : 0,
      largestLoss: losses.length ? _.minBy(losses, 'net_pnl').net_pnl : 0,
      avgHoldMs: holdList.length ? _.mean(holdList) : null,
      trades: ts,
    };
  });
}

function groupSOEvents(trades) {
  const so = trades
    .filter(t => t.close_reason === 'so' && t.close_time)
    .slice()
    .sort((a, b) => a.close_time - b.close_time);

  const events = [];
  let cur = null;
  so.forEach(t => {
    if (!cur) { cur = { trades: [t], start: t.close_time, end: t.close_time }; return; }
    if (t.close_time - cur.end <= 60_000) {
      cur.trades.push(t);
      cur.end = t.close_time;
    } else {
      events.push(cur);
      cur = { trades: [t], start: t.close_time, end: t.close_time };
    }
  });
  if (cur) events.push(cur);

  return events.map((e, i) => {
    const buys  = e.trades.filter(t => t.type === 'buy').length;
    const sells = e.trades.filter(t => t.type === 'sell').length;
    const lots  = _.sumBy(e.trades, t => isFinite(t.lots) ? t.lots : 0);
    const symbols = _.countBy(e.trades, 'symbol');
    const totalLoss = _.sumBy(e.trades, 'net_pnl');
    const largest = _.minBy(e.trades, 'net_pnl');
    return {
      id: `SO-${i + 1}`,
      start: e.start, end: e.end,
      durationMs: e.end - e.start,
      trades: e.trades,
      tradeCount: e.trades.length,
      totalLoss,
      symbols, buys, sells, lots,
      largestSingleLoss: largest ? largest.net_pnl : 0,
      largestSingleTicket: largest ? largest.ticket : null,
    };
  });
}

function computeCumulative(trades) {
  let cum = 0;
  return trades.map((t, i) => {
    cum += t.net_pnl;
    return { idx: i + 1, cum, trade: t };
  });
}

function computeHistogram(trades, bins = 20) {
  if (!trades.length) return { bins: [], mean: 0, median: 0 };
  const values = trades.map(t => t.net_pnl);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { bins: [{ x0: min, x1: max, count: trades.length, label: fmtCurrency(min, 0) }], mean: min, median: min };
  const width = (max - min) / bins;
  const result = Array.from({ length: bins }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
    label: fmtCurrency(min + i * width + width / 2, 0),
  }));
  values.forEach(v => {
    let i = Math.floor((v - min) / width);
    if (i >= bins) i = bins - 1;
    if (i < 0) i = 0;
    result[i].count++;
  });
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { bins: result, mean: _.mean(values), median };
}

function computeTimeAnalysis(trades) {
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const byDow = Array.from({ length: 7 }, (_, i) => ({ name: dows[i], count: 0, totalPnl: 0 }));
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, totalPnl: 0 }));
  trades.forEach(t => {
    if (t.open_time) {
      const dow = t.open_time.getUTCDay();
      const h   = t.open_time.getUTCHours();
      byDow[dow].count++;  byDow[dow].totalPnl  += t.net_pnl;
      byHour[h].count++;   byHour[h].totalPnl  += t.net_pnl;
    }
  });
  byDow.forEach(d => d.avgPnl = d.count ? d.totalPnl / d.count : 0);
  byHour.forEach(h => h.avgPnl = h.count ? h.totalPnl / h.count : 0);

  const byBucket = HOLD_BUCKETS.map(b => ({ key: b.key, label: b.label, count: 0, wins: 0, losses: 0, totalPnl: 0 }));
  trades.forEach(t => {
    const k = holdBucketKey(t.hold_time_ms);
    if (!k) return;
    const row = byBucket.find(b => b.key === k);
    row.count++;
    if (t.net_pnl > 0) row.wins++;
    else if (t.net_pnl < 0) row.losses++;
    row.totalPnl += t.net_pnl;
  });
  byBucket.forEach(b => {
    b.winRate = b.count ? (b.wins / b.count) * 100 : 0;
    b.avgPnl  = b.count ? b.totalPnl / b.count : 0;
  });

  const scatter = trades
    .filter(t => isFinite(t.hold_time_hours))
    .map(t => ({ hours: t.hold_time_hours, pnl: t.net_pnl, win: t.net_pnl > 0 }));

  return { byDow, byHour, byBucket, scatter };
}

// ============================================================================
// LLM API — Groq (OpenAI-compatible). Hits a same-origin proxy so the API key
// stays server-side. Configure the proxy in vite.config.js (dev) and as a
// Cloudflare Pages Function / equivalent (prod). Set GROQ_API_KEY there.
// ============================================================================
async function callLLM(prompt) {
  const response = await fetch('/api/groq/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${text || response.statusText}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ============================================================================
// Tiny markdown renderer (headers, bold, lists, paragraphs)
// ============================================================================
function MarkdownView({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = [];
  let listBuf = [];
  const flushList = () => {
    if (!listBuf.length) return;
    out.push(<ul key={`ul-${out.length}`} className="list-disc pl-6 space-y-1 my-2">
      {listBuf.map((l, i) => <li key={i} dangerouslySetInnerHTML={{ __html: renderInline(l) }} />)}
    </ul>);
    listBuf = [];
  };
  function renderInline(s) {
    return s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="bg-slate-800 px-1 rounded">$1</code>');
  }
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line))      { flushList(); out.push(<h4 key={idx} className="text-base font-semibold text-white mt-4 mb-1">{line.replace(/^###\s+/, '')}</h4>); return; }
    if (/^##\s+/.test(line))       { flushList(); out.push(<h3 key={idx} className="text-lg font-semibold text-white mt-5 mb-2 border-b border-slate-700 pb-1">{line.replace(/^##\s+/, '')}</h3>); return; }
    if (/^#\s+/.test(line))        { flushList(); out.push(<h2 key={idx} className="text-xl font-bold text-white mt-5 mb-2">{line.replace(/^#\s+/, '')}</h2>); return; }
    if (/^\s*[-*]\s+/.test(line))  { listBuf.push(line.replace(/^\s*[-*]\s+/, '')); return; }
    if (/^\s*\d+\.\s+/.test(line)) { listBuf.push(line.replace(/^\s*\d+\.\s+/, '')); return; }
    if (line === '')               { flushList(); return; }
    flushList();
    out.push(<p key={idx} className="text-slate-300 my-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: renderInline(line) }} />);
  });
  flushList();
  return <div>{out}</div>;
}

// ============================================================================
// Reusable UI primitives
// ============================================================================
function Card({ children, className = '', title, action }) {
  return (
    <div className={`rounded-xl border border-slate-700 bg-slate-800/60 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function MetricCard({ label, value, sub, color }) {
  const valueColor = color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-white';
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-xl font-bold mt-1 ${valueColor}`}>{value}</div>
      {sub != null && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Btn({ children, onClick, variant = 'primary', disabled, className = '', icon: Icon }) {
  const base = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900';
  const v = variant === 'primary' ? 'bg-blue-600 hover:bg-blue-500 text-white focus:ring-blue-400'
        : variant === 'success' ? 'bg-green-600 hover:bg-green-500 text-white focus:ring-green-400'
        : variant === 'danger'  ? 'bg-red-600 hover:bg-red-500 text-white focus:ring-red-400'
        : variant === 'ghost'   ? 'bg-transparent hover:bg-slate-700 text-slate-200 border border-slate-600'
        : 'bg-slate-700 hover:bg-slate-600 text-white focus:ring-slate-400';
  const dis = disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${v} ${dis} ${className}`}>
      {Icon && <Icon size={16} />}{children}
    </button>
  );
}

function Stepper({ step }) {
  const labels = ['Upload CSV', 'Map Columns', 'Clean & Confirm'];
  return (
    <div className="flex items-center gap-2">
      {labels.map((l, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <React.Fragment key={l}>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm
              ${active ? 'bg-blue-600 text-white' : done ? 'bg-green-600/20 text-green-300 border border-green-700' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                ${active ? 'bg-white/20' : done ? 'bg-green-600 text-white' : 'bg-slate-700'}`}>
                {done ? '✓' : n}
              </span>
              {l}
            </div>
            {i < labels.length - 1 && <div className={`flex-1 h-px ${done ? 'bg-green-700' : 'bg-slate-700'}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

const TooltipBox = ({ active, payload, label, formatter }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg p-3 text-xs shadow-xl">
      {label != null && <div className="font-semibold text-slate-200 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="text-white font-medium">
            {formatter ? formatter(p.value, p.name, p.payload) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// Step 1: Upload
// ============================================================================
function StepUpload({ onParsed, onSample }) {
  const [error, setError] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);
  const dropRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a .csv file.');
      return;
    }
    setError(null);
    setParsing(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        setParsing(false);
        if (!results.data || !results.data.length) {
          setError('CSV appears to be empty.');
          return;
        }
        const columns = results.meta.fields || Object.keys(results.data[0]);
        setPreview({
          fileName: file.name,
          rowCount: results.data.length,
          columnCount: columns.length,
          columns,
          rows: results.data,
          previewRows: results.data.slice(0, 5),
        });
      },
      error: (err) => { setParsing(false); setError(`Parse error: ${err.message}`); },
    });
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="max-w-4xl mx-auto">
      <div
        ref={dropRef}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed cursor-pointer transition-colors p-12 text-center
          ${dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 bg-slate-800/40 hover:bg-slate-800/60'}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <Upload size={48} className="mx-auto text-slate-400 mb-3" />
        <div className="text-lg font-semibold text-white">Drop your CSV here, or click to browse</div>
        <div className="text-sm text-slate-400 mt-1">Supports Exness, MetaTrader, Binance, IC Markets, XM, cTrader and any custom CSV</div>
        {parsing && <div className="text-blue-400 mt-3 text-sm">Parsing…</div>}
        {error && <div className="text-red-400 mt-3 text-sm">{error}</div>}
      </div>

      <div className="flex items-center justify-between mt-4">
        <Btn variant="ghost" icon={Sparkles} onClick={onSample}>Load Sample Data</Btn>
        {preview && (
          <Btn variant="primary" onClick={() => onParsed(preview)} icon={ChevronRight}>
            Next → Map Columns
          </Btn>
        )}
      </div>

      {preview && (
        <Card className="mt-6" title={`${preview.fileName} • ${preview.rowCount.toLocaleString()} rows • ${preview.columnCount} columns`}>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  {preview.columns.map(c => <th key={c} className="text-left px-2 py-1.5 font-medium whitespace-nowrap">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-800">
                    {preview.columns.map(c => (
                      <td key={c} className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{String(row[c] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Step 2: Mapping
// ============================================================================
function StepMapping({ parsed, onConfirm, onBack }) {
  const initialMapping = useMemo(() => autoDetectMapping(parsed.columns), [parsed.columns]);
  const broker = useMemo(() => detectBrokerPreset(parsed.columns), [parsed.columns]);
  const [mapping, setMapping] = useState(initialMapping);

  // Timezone — sessions are bucketed in UTC, so broker server-time CSVs need an offset.
  const timeColumnsLookUtc = useMemo(() => {
    const timeCols = Object.entries(mapping)
      .filter(([_c, f]) => f === 'open_time' || f === 'close_time')
      .map(([c]) => c);
    return timeCols.length > 0 && timeCols.every(c => /utc/i.test(c));
  }, [mapping]);
  const [tzPreset, setTzPreset] = useState(0);
  const [tzCustom, setTzCustom] = useState(0);
  const tzOffsetHours = tzPreset === 'custom' ? Number(tzCustom) || 0 : tzPreset;

  const usedFields = useMemo(() => {
    const m = {};
    Object.values(mapping).forEach(f => { if (f && f !== '__skip__') m[f] = (m[f] || 0) + 1; });
    return m;
  }, [mapping]);

  const missingRequired = REQUIRED_FIELDS.filter(f => !usedFields[f]);
  const duplicateFields = Object.entries(usedFields).filter(([_f, n]) => n > 1).map(([f]) => f);
  const canProceed = missingRequired.length === 0 && duplicateFields.length === 0;

  return (
    <div className="max-w-5xl mx-auto">
      {broker && (
        <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-700 text-blue-200 flex items-center gap-2">
          <CheckCircle size={18} />
          <span><strong>Detected: {broker} format</strong> — columns auto-mapped. You can still edit any field below.</span>
        </div>
      )}

      <Card title={`Map columns from ${parsed.fileName}`}>
        <div className="text-sm text-slate-400 mb-4">
          Tell the app which of your columns maps to which internal field. Required fields:
          {' '}{REQUIRED_FIELDS.map(f => (
            <span key={f} className={`mx-1 px-2 py-0.5 rounded text-xs ${usedFields[f] ? 'bg-green-700/30 text-green-300' : 'bg-red-700/30 text-red-300'}`}>
              {FIELDS_BY_KEY[f].label}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="text-left px-3 py-2 font-medium">Your column (CSV)</th>
                <th className="text-left px-3 py-2 font-medium">Maps to</th>
                <th className="text-left px-3 py-2 font-medium">Sample value</th>
              </tr>
            </thead>
            <tbody>
              {parsed.columns.map(col => {
                const sample = parsed.rows[0]?.[col];
                const current = mapping[col];
                const auto = initialMapping[col];
                const isAuto = auto === current && current !== '__skip__';
                const dup = current !== '__skip__' && usedFields[current] > 1;
                return (
                  <tr key={col} className="border-b border-slate-800">
                    <td className="px-3 py-2 text-slate-200 font-mono text-xs">{col}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={current}
                          onChange={(e) => setMapping(m => ({ ...m, [col]: e.target.value }))}
                          className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white"
                        >
                          <option value="__skip__">— skip —</option>
                          {INTERNAL_FIELDS.map(f => (
                            <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                          ))}
                        </select>
                        {isAuto && <CheckCircle size={14} className="text-green-400" title="Auto-detected" />}
                        {dup && <AlertTriangle size={14} className="text-amber-400" title="Same field used by multiple columns" />}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-400 font-mono text-xs">{String(sample ?? '')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {missingRequired.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-center gap-2">
            <AlertTriangle size={16} />
            Required fields missing: {missingRequired.map(f => FIELDS_BY_KEY[f].label).join(', ')}
          </div>
        )}
        {duplicateFields.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-amber-900/30 border border-amber-800 text-amber-300 text-sm flex items-center gap-2">
            <AlertTriangle size={16} />
            Multiple columns mapped to: {duplicateFields.map(f => FIELDS_BY_KEY[f].label).join(', ')}. Pick one.
          </div>
        )}
      </Card>

      <Card title="Timestamp timezone" className="mt-4">
        <div className="text-sm text-slate-400 mb-3">
          Trading-session analysis assumes UTC. If your CSV is in <strong className="text-slate-200">broker server time</strong>{' '}
          (most MT4/5 brokers — IC Markets, XM, Pepperstone, etc. — run on GMT+2 or GMT+3), pick that offset here so sessions are bucketed correctly.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={tzPreset}
            onChange={(e) => {
              const v = e.target.value === 'custom' ? 'custom' : Number(e.target.value);
              setTzPreset(v);
            }}
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-white min-w-[280px]"
          >
            {TIMEZONE_PRESETS.map(p => (
              <option key={String(p.value)} value={p.value}>{p.label}</option>
            ))}
          </select>
          {tzPreset === 'custom' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Hours from UTC:</span>
              <input
                type="number"
                step="0.5"
                value={tzCustom}
                onChange={(e) => setTzCustom(e.target.value)}
                className="bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-white w-24"
              />
            </div>
          )}
          <div className="text-xs text-slate-500">
            Effective: <strong className="text-slate-300">{tzOffsetHours === 0 ? 'UTC (no shift)' : `UTC${tzOffsetHours > 0 ? '+' : ''}${tzOffsetHours}`}</strong>
          </div>
        </div>
        {timeColumnsLookUtc && tzOffsetHours !== 0 && (
          <div className="mt-3 p-3 rounded-lg bg-amber-900/30 border border-amber-800 text-amber-300 text-sm flex items-center gap-2">
            <AlertTriangle size={16} />
            Your time column name contains "UTC" but you've selected a non-UTC offset. Double-check — the CSV may already be in UTC.
          </div>
        )}
        {!timeColumnsLookUtc && tzOffsetHours === 0 && (
          <div className="mt-3 p-3 rounded-lg bg-slate-700/30 border border-slate-600 text-slate-300 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 text-amber-400 shrink-0" />
            <span>Time column doesn't say "UTC". If you exported from MetaTrader 4/5, it's almost certainly broker server time — pick GMT+2 or GMT+3 above before continuing, or your sessions will be off by 2–3 hours.</span>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between mt-4">
        <Btn variant="ghost" icon={ChevronLeft} onClick={onBack}>Back</Btn>
        <Btn variant="primary" disabled={!canProceed} onClick={() => onConfirm(mapping, tzOffsetHours)} icon={ChevronRight}>
          Next → Clean Data
        </Btn>
      </div>
    </div>
  );
}

// ============================================================================
// Step 3: Cleaning report
// ============================================================================
function StepClean({ parsed, mapping, tzOffsetHours, onLaunch, onBack }) {
  const cleaned = useMemo(() => cleanData(parsed.rows, mapping, tzOffsetHours), [parsed.rows, mapping, tzOffsetHours]);
  const { trades, dropped, mapping: inv, warnings } = cleaned;
  const [showDropped, setShowDropped] = useState(false);

  const stats = useMemo(() => {
    if (!trades.length) return null;
    const dates = trades.map(t => t.close_time || t.open_time).filter(Boolean);
    const symbolCounts = _.countBy(trades, 'symbol');
    const reasonCounts = inv.close_reason ? _.countBy(trades.filter(t => t.close_reason), 'close_reason') : null;
    const pnls = trades.map(t => t.pnl);
    const missingOptional = INTERNAL_FIELDS.filter(f => !f.required && !inv[f.key]).map(f => f.label);
    return {
      dateRange: dates.length ? { start: _.min(dates), end: _.max(dates) } : null,
      symbolCounts,
      reasonCounts,
      pnlMin: Math.min(...pnls),
      pnlMax: Math.max(...pnls),
      missingOptional,
    };
  }, [trades, inv]);

  return (
    <div className="max-w-4xl mx-auto">
      <Card title="Cleaning report">
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 text-green-300">
            <CheckCircle size={16} />
            <span>Successfully loaded: <strong className="text-white">{trades.length.toLocaleString()}</strong> trades</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <AlertTriangle size={16} className={dropped.length ? 'text-amber-400' : 'text-slate-500'} />
            <span>Dropped: <strong className="text-white">{dropped.length}</strong> invalid rows</span>
            {dropped.length > 0 && (
              <button className="text-blue-400 underline ml-2" onClick={() => setShowDropped(s => !s)}>
                {showDropped ? 'hide' : 'show'} details
              </button>
            )}
          </div>
          {showDropped && dropped.length > 0 && (
            <div className="ml-6 max-h-48 overflow-auto bg-slate-900/60 border border-slate-700 rounded-lg p-3 text-xs font-mono">
              {dropped.slice(0, 50).map((d, i) => (
                <div key={i} className="text-slate-400 border-b border-slate-800 py-1">
                  Row {d.idx + 1}: {d.reason}
                </div>
              ))}
              {dropped.length > 50 && <div className="text-slate-500 italic">…{dropped.length - 50} more</div>}
            </div>
          )}
          {stats && stats.dateRange && (
            <div className="text-slate-300">📅 Date range: <strong className="text-white">{fmtDate(stats.dateRange.start)} – {fmtDate(stats.dateRange.end)}</strong></div>
          )}
          {stats && (
            <div className="text-slate-300">
              📊 Symbols: {Object.entries(stats.symbolCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s, n]) => (
                <span key={s} className="inline-block mr-2 mt-1 px-2 py-0.5 bg-slate-700 rounded text-xs">{s} ({n})</span>
              ))}
            </div>
          )}
          {stats && (
            <div className="text-slate-300">
              💰 PnL range: <span className="text-red-400">{fmtCurrency(stats.pnlMin)}</span> to <span className="text-green-400">{fmtCurrency(stats.pnlMax)}</span>
            </div>
          )}
          {stats && stats.reasonCounts && (
            <div className="text-slate-300">
              📋 Close reasons: {Object.entries(stats.reasonCounts).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
                <span key={r} className="inline-block mr-2 mt-1 px-2 py-0.5 bg-slate-700 rounded text-xs">{r} ({n})</span>
              ))}
            </div>
          )}
          {stats && stats.missingOptional.length > 0 && (
            <div className="text-amber-300 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5" />
              <span>Optional fields missing: {stats.missingOptional.join(', ')}.{!inv.close_reason && ' Close Reason tab will be hidden.'}{(!inv.commission && !inv.swap) && ' Net PnL = PnL (no commission/swap).'}</span>
            </div>
          )}
          {warnings.length > 0 && warnings.map((w, i) => (
            <div key={i} className="text-amber-300 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5" />{w}</div>
          ))}
        </div>
      </Card>

      <div className="flex items-center justify-between mt-4">
        <Btn variant="ghost" icon={ChevronLeft} onClick={onBack}>Back to Mapping</Btn>
        <Btn variant="success" disabled={!trades.length} onClick={() => onLaunch({ trades, mapping: inv })} icon={ChevronRight}>
          Launch Dashboard →
        </Btn>
      </div>
    </div>
  );
}

// ============================================================================
// AI per-tab analyze button
// ============================================================================
function AnalyzeThis({ buildPrompt, label = 'Analyze This' }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null); setResult(null); setOpen(true);
    try {
      const text = await callLLM(buildPrompt());
      setResult(text);
    } catch (e) {
      setError(e.message || 'Request failed');
    } finally { setLoading(false); }
  }, [buildPrompt]);

  return (
    <>
      <Btn variant="ghost" icon={Brain} onClick={run}>🤖 {label}</Btn>
      {open && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !loading && setOpen(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl max-w-3xl w-full max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-2"><Brain size={18} className="text-blue-400" /><h3 className="font-semibold text-white">{label}</h3></div>
              <button onClick={() => !loading && setOpen(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5">
              {loading && <div className="flex items-center gap-3 text-slate-300"><RefreshCw size={16} className="animate-spin" />Analyzing your trading data…</div>}
              {error && <div className="text-red-400 text-sm">{error}<div className="mt-2"><Btn variant="ghost" onClick={run} icon={RefreshCw}>Retry</Btn></div></div>}
              {result && <MarkdownView text={result} />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Tabs — Overview
// ============================================================================
function OverviewTab({ trades, core, bySymbol, cumulative, histogram }) {
  const cumColor = core.netPnl >= 0 ? C.green : C.red;
  const buildPrompt = () => `Analyze this trader's overall performance.\n\n` +
    `Total trades: ${core.total}\nWin rate: ${fmtPct(core.winRate)}\nNet PnL: ${fmtCurrency(core.netPnl)}\n` +
    `Profit factor: ${isFinite(core.profitFactor) ? core.profitFactor.toFixed(2) : 'inf'}\n` +
    `Avg win: ${fmtCurrency(core.avgWin)}\nAvg loss: ${fmtCurrency(core.avgLoss)}\nR:R: ${core.rrRatio.toFixed(2)}\n` +
    `Expectancy: ${fmtCurrency(core.expectancy)}\nLargest win: ${fmtCurrency(core.largestWin)}\nLargest loss: ${fmtCurrency(core.largestLoss)}\n` +
    `Max consecutive wins: ${core.maxConsWins}, losses: ${core.maxConsLosses}\n\nBy symbol:\n` +
    bySymbol.map(s => `- ${s.symbol}: ${s.count} trades, win ${fmtPct(s.winRate)}, PnL ${fmtCurrency(s.totalPnl)}`).join('\n') +
    `\n\nProvide: 1) overall assessment, 2) top 3 strengths, 3) top 3 weaknesses, 4) symbol-specific recommendations. Be specific and reference numbers.`;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><AnalyzeThis buildPrompt={buildPrompt} label="Analyze Overview" /></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total Trades" value={core.total.toLocaleString()} />
        <MetricCard label="Winning Trades" value={core.wins.toLocaleString()} sub={fmtPct(core.winRate)} color="green" />
        <MetricCard label="Losing Trades" value={core.losses.toLocaleString()} sub={fmtPct(core.lossRate)} color="red" />
        <MetricCard label="Break Even" value={core.breakEven.toLocaleString()} />
        <MetricCard label="Net PnL" value={fmtCurrency(core.netPnl)} color={core.netPnl >= 0 ? 'green' : 'red'} />
        <MetricCard label="Gross Profit" value={fmtCurrency(core.grossProfit)} color="green" />
        <MetricCard label="Gross Loss"   value={fmtCurrency(core.grossLoss)}   color="red" />
        <MetricCard label="Profit Factor" value={isFinite(core.profitFactor) ? core.profitFactor.toFixed(2) : '∞'} />
        <MetricCard label="Average Win" value={fmtCurrency(core.avgWin)} color="green" />
        <MetricCard label="Average Loss" value={fmtCurrency(core.avgLoss)} color="red" />
        <MetricCard label="Reward : Risk" value={core.rrRatio.toFixed(2)} />
        <MetricCard label="Expectancy" value={fmtCurrency(core.expectancy)} color={core.expectancy >= 0 ? 'green' : 'red'} />
        <MetricCard label="Largest Win" value={fmtCurrency(core.largestWin)} color="green" />
        <MetricCard label="Largest Loss" value={fmtCurrency(core.largestLoss)} color="red" />
        <MetricCard label="Max Consec. Wins" value={core.maxConsWins} color="green" />
        <MetricCard label="Max Consec. Losses" value={core.maxConsLosses} color="red" />
        <MetricCard label="Avg Trade Duration" value={fmtDuration(core.avgHoldMs)} />
      </div>

      <Card title="Cumulative PnL (chronological by close time)">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={cumulative} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
            <XAxis dataKey="idx" stroke={C.textMuted} fontSize={11} />
            <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
            <Tooltip content={<TooltipBox formatter={(v, _n, p) => `${fmtCurrency(v)} (trade ${p.idx}: ${p.trade?.symbol || '—'} ${fmtCurrency(p.trade?.net_pnl)})`} />} />
            <ReferenceLine y={0} stroke={C.textDim} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="cum" name="Cumulative PnL" stroke={cumColor} strokeWidth={1.5} dot={cumulative.length > 500 ? false : { r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={`PnL Distribution — mean ${fmtCurrency(histogram.mean)} • median ${fmtCurrency(histogram.median)}`}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={histogram.bins}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke={C.textMuted} fontSize={10} angle={-30} textAnchor="end" height={50} interval={0} />
              <YAxis stroke={C.textMuted} fontSize={11} />
              <Tooltip content={<TooltipBox />} />
              <Bar dataKey="count" name="Trades">
                {histogram.bins.map((b, i) => <Cell key={i} fill={(b.x0 + b.x1) / 2 >= 0 ? C.green : C.red} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Performance by Symbol">
          <ResponsiveContainer width="100%" height={Math.max(280, bySymbol.length * 36)}>
            <BarChart data={bySymbol} layout="vertical" margin={{ left: 20, right: 30, top: 10, bottom: 5 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis type="number" stroke={C.textMuted} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
              <YAxis type="category" dataKey="symbol" stroke={C.textMuted} fontSize={11} width={80} />
              <Tooltip content={<TooltipBox formatter={(v, _n, p) => `${fmtCurrency(v)} • ${p.count} trades • win ${fmtPct(p.winRate)}`} />} />
              <Bar dataKey="totalPnl" name="Net PnL">
                {bySymbol.map((s, i) => <Cell key={i} fill={s.totalPnl >= 0 ? C.green : C.red} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Tab — Close Reason
// ============================================================================
function CloseReasonTab({ trades, byReason, core }) {
  const buildPrompt = () => `Analyze this trader's close-reason patterns. Are stop losses too tight/wide? Are manual closes helping or hurting? Is TP optimized?\n\n` +
    byReason.map(r => `- ${r.reason}: ${r.count} trades (${fmtPct(r.pct)}), win ${fmtPct(r.winRate)}, PnL ${fmtCurrency(r.totalPnl)}, avg ${fmtCurrency(r.avgPnl)}, avg win ${fmtCurrency(r.avgWin)}, avg loss ${fmtCurrency(r.avgLoss)}, PF ${isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : 'inf'}`).join('\n') +
    `\n\nOverall win rate: ${fmtPct(core.winRate)}.\nGive specific advice on each close type and at most 3 concrete changes.`;

  const reasonColor = (r) => r === 'tp' ? C.green : r === 'sl' ? C.red : r === 'so' ? '#dc2626' : r === 'user' ? C.blue : C.amber;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><AnalyzeThis buildPrompt={buildPrompt} label="Analyze Close Reasons" /></div>

      <Card title="Close-reason summary">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 border-b border-slate-700">
              <tr>
                {['Reason','Count','% Total','Win Rate','Total PnL','Avg PnL','Avg Win','Avg Loss','Profit Factor','Avg Hold'].map(h => (
                  <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byReason.map(r => (
                <tr key={r.reason} className="border-b border-slate-800">
                  <td className="px-3 py-2"><span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: reasonColor(r.reason) + '33', color: reasonColor(r.reason) }}>{r.reason}</span></td>
                  <td className="px-3 py-2 text-slate-200">{r.count}</td>
                  <td className="px-3 py-2 text-slate-400">{fmtPct(r.pct)}</td>
                  <td className="px-3 py-2" style={{ color: r.winRate >= 50 ? C.green : C.red }}>{fmtPct(r.winRate)}</td>
                  <td className="px-3 py-2" style={{ color: r.totalPnl >= 0 ? C.green : C.red }}>{fmtCurrency(r.totalPnl)}</td>
                  <td className="px-3 py-2" style={{ color: r.avgPnl >= 0 ? C.green : C.red }}>{fmtCurrency(r.avgPnl)}</td>
                  <td className="px-3 py-2 text-green-400">{fmtCurrency(r.avgWin)}</td>
                  <td className="px-3 py-2 text-red-400">{fmtCurrency(r.avgLoss)}</td>
                  <td className="px-3 py-2 text-slate-200">{isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞'}</td>
                  <td className="px-3 py-2 text-slate-400">{fmtDuration(r.avgHoldMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Win rate by close reason">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byReason}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="reason" stroke={C.textMuted} fontSize={11} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<TooltipBox formatter={(v) => fmtPct(v)} />} />
              <ReferenceLine y={core.winRate} stroke={C.amber} strokeDasharray="4 4" label={{ value: `Avg ${fmtPct(core.winRate)}`, position: 'right', fill: C.amber, fontSize: 10 }} />
              <Bar dataKey="winRate" name="Win Rate">
                {byReason.map((r, i) => <Cell key={i} fill={r.winRate >= core.winRate ? C.green : C.red} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Gross profit vs loss by close reason">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byReason}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="reason" stroke={C.textMuted} fontSize={11} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
              <Tooltip content={<TooltipBox formatter={(v) => fmtCurrency(v)} />} />
              <Bar dataKey="grossProfit" name="Gross profit" fill={C.green} />
              <Bar dataKey="grossLoss" name="Gross loss" fill={C.red} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Trade distribution">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={byReason} dataKey="count" nameKey="reason" innerRadius={60} outerRadius={100} paddingAngle={2}>
                {byReason.map((r, i) => <Cell key={i} fill={reasonColor(r.reason)} />)}
              </Pie>
              <Tooltip content={<TooltipBox formatter={(v, _n, p) => `${v} trades (${fmtPct(p.pct)})`} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Avg hold time by close reason">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byReason.map(r => ({ ...r, avgHoldHours: r.avgHoldMs ? r.avgHoldMs / 3600000 : 0 }))}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="reason" stroke={C.textMuted} fontSize={11} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => `${v.toFixed(1)}h`} />
              <Tooltip content={<TooltipBox formatter={(_v, _n, p) => fmtDuration(p.avgHoldMs)} />} />
              <Bar dataKey="avgHoldHours" name="Avg hold (h)">
                {byReason.map((r, i) => <Cell key={i} fill={reasonColor(r.reason)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Tab — Trading Sessions
// ============================================================================
function SessionsTab({ bySession, core, hasCloseReason, trades }) {
  const cumBySession = useMemo(() => {
    const out = {};
    SESSIONS.forEach(s => { out[s] = []; });
    bySession.forEach(s => {
      let cum = 0;
      s.trades.forEach((t, i) => { cum += t.net_pnl; out[s.session].push({ idx: i + 1, cum }); });
    });
    return out;
  }, [bySession]);

  const symbols = useMemo(() => _.uniq(trades.map(t => t.symbol)).slice(0, 8), [trades]);
  const sessXSymbol = useMemo(() => {
    const m = {};
    SESSIONS.forEach(s => { m[s] = {}; symbols.forEach(sym => { m[s][sym] = { pnl: 0, count: 0 }; }); });
    trades.forEach(t => {
      const s = getSession(t.open_time);
      if (s && symbols.includes(t.symbol)) {
        m[s][t.symbol].pnl += t.net_pnl;
        m[s][t.symbol].count++;
      }
    });
    return m;
  }, [trades, symbols]);

  const reasonsList = useMemo(() => hasCloseReason ? _.uniq(trades.map(t => t.close_reason).filter(Boolean)) : [], [trades, hasCloseReason]);
  const sessXReason = useMemo(() => {
    if (!hasCloseReason) return null;
    return SESSIONS.map(s => {
      const ts = bySession.find(x => x.session === s)?.trades || [];
      const total = ts.length;
      const row = { session: s, total };
      reasonsList.forEach(r => {
        const c = ts.filter(t => t.close_reason === r).length;
        row[r] = total ? (c / total) * 100 : 0;
      });
      return row;
    });
  }, [bySession, hasCloseReason, reasonsList]);

  const best  = _.maxBy(bySession.filter(s => s.count > 0), 'totalPnl');
  const worst = _.minBy(bySession.filter(s => s.count > 0), 'totalPnl');

  const buildPrompt = () => `Analyze this trader's performance across trading sessions.\n\n` +
    bySession.filter(s => s.count > 0).map(s =>
      `- ${s.session}: ${s.count} trades (${fmtPct(s.pct)}), win ${fmtPct(s.winRate)}, PnL ${fmtCurrency(s.totalPnl)}, avg ${fmtCurrency(s.avgPnl)}, PF ${isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf'}, R:R ${s.rrRatio.toFixed(2)}, hold ${fmtDuration(s.avgHoldMs)}`
    ).join('\n') +
    `\nOverall win rate: ${fmtPct(core.winRate)}.\n` +
    `\nIdentify: which session is most/least profitable, whether the trader should avoid any session, if there are session-symbol patterns worth exploiting, and whether their exit strategy changes by session.`;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><AnalyzeThis buildPrompt={buildPrompt} label="Analyze Sessions" /></div>

      <Card title="Session performance summary">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 border-b border-slate-700">
              <tr>
                {['Session','Trades','%','Win Rate','PnL','Avg PnL','Gross +','Gross −','PF','R:R','Largest +','Largest −','Avg Hold'].map(h =>
                  <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {bySession.map(s => {
                const isBest = best && s.session === best.session;
                const isWorst = worst && s.session === worst.session;
                return (
                  <tr key={s.session} className={`border-b border-slate-800 ${isBest ? 'bg-green-900/20' : isWorst ? 'bg-red-900/20' : ''}`}>
                    <td className="px-3 py-2 text-white font-medium flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: SESSION_COLORS[s.session] }} />
                      {s.session}
                      {isBest && <span className="text-xs text-green-400">★ best</span>}
                      {isWorst && <span className="text-xs text-red-400">⚠ worst</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-200">{s.count}</td>
                    <td className="px-3 py-2 text-slate-400">{fmtPct(s.pct)}</td>
                    <td className="px-3 py-2" style={{ color: s.winRate >= core.winRate ? C.green : C.red }}>{fmtPct(s.winRate)}</td>
                    <td className="px-3 py-2" style={{ color: s.totalPnl >= 0 ? C.green : C.red }}>{fmtCurrency(s.totalPnl)}</td>
                    <td className="px-3 py-2" style={{ color: s.avgPnl >= 0 ? C.green : C.red }}>{fmtCurrency(s.avgPnl)}</td>
                    <td className="px-3 py-2 text-green-400">{fmtCurrency(s.grossProfit)}</td>
                    <td className="px-3 py-2 text-red-400">{fmtCurrency(s.grossLoss)}</td>
                    <td className="px-3 py-2 text-slate-200">{isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</td>
                    <td className="px-3 py-2 text-slate-200">{s.rrRatio.toFixed(2)}</td>
                    <td className="px-3 py-2 text-green-400">{fmtCurrency(s.largestWin)}</td>
                    <td className="px-3 py-2 text-red-400">{fmtCurrency(s.largestLoss)}</td>
                    <td className="px-3 py-2 text-slate-400">{fmtDuration(s.avgHoldMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="PnL by session">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bySession}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="session" stroke={C.textMuted} fontSize={10} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
              <Tooltip content={<TooltipBox formatter={(v, _n, p) => `${fmtCurrency(v)} (${p.count} trades)`} />} />
              <Bar dataKey="totalPnl" name="PnL">
                {bySession.map((s, i) => <Cell key={i} fill={s.totalPnl >= 0 ? C.green : C.red} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Win rate by session">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bySession}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="session" stroke={C.textMuted} fontSize={10} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<TooltipBox formatter={(v) => fmtPct(v)} />} />
              <ReferenceLine y={core.winRate} stroke={C.amber} strokeDasharray="4 4" label={{ value: `Avg ${fmtPct(core.winRate)}`, position: 'right', fill: C.amber, fontSize: 10 }} />
              <Bar dataKey="winRate" name="Win rate">
                {bySession.map((s, i) => <Cell key={i} fill={s.winRate >= core.winRate ? C.green : C.amber} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Session distribution">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={bySession.filter(s => s.count > 0)} dataKey="count" nameKey="session" innerRadius={60} outerRadius={100} paddingAngle={2}>
                {bySession.filter(s => s.count > 0).map((s, i) => <Cell key={i} fill={SESSION_COLORS[s.session]} />)}
              </Pie>
              <Tooltip content={<TooltipBox formatter={(v, _n, p) => `${v} trades (${fmtPct(p.pct)})`} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Cumulative PnL by session">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="idx" type="number" stroke={C.textMuted} fontSize={11} domain={['dataMin', 'dataMax']} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
              <Tooltip content={<TooltipBox formatter={(v) => fmtCurrency(v)} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke={C.textDim} strokeDasharray="4 4" />
              {SESSIONS.map(s => (
                cumBySession[s].length > 0 && (
                  <Line key={s} data={cumBySession[s]} type="monotone" dataKey="cum" name={s} stroke={SESSION_COLORS[s]} dot={false} strokeWidth={1.5} />
                )
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Session × Symbol — total PnL">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400 border-b border-slate-700">
              <th className="text-left px-3 py-2">Session \ Symbol</th>
              {symbols.map(sym => <th key={sym} className="text-right px-3 py-2">{sym}</th>)}
            </tr></thead>
            <tbody>
              {SESSIONS.map(s => (
                <tr key={s} className="border-b border-slate-800">
                  <td className="px-3 py-2 text-white font-medium">{s}</td>
                  {symbols.map(sym => {
                    const cell = sessXSymbol[s][sym];
                    if (!cell.count) return <td key={sym} className="text-right px-3 py-2 text-slate-600">—</td>;
                    const intensity = Math.min(1, Math.abs(cell.pnl) / 1000);
                    const bg = cell.pnl >= 0 ? `rgba(34,197,94,${intensity * 0.5})` : `rgba(239,68,68,${intensity * 0.5})`;
                    return (
                      <td key={sym} className="text-right px-3 py-2" style={{ background: bg }}>
                        <div className="text-white font-mono">{fmtCurrency(cell.pnl, 0)}</div>
                        <div className="text-slate-400 text-[10px]">{cell.count} trades</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {hasCloseReason && (
        <Card title="Session × Close reason (% of session trades)">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={sessXReason}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="session" stroke={C.textMuted} fontSize={11} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<TooltipBox formatter={(v) => fmtPct(v)} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {reasonsList.map((r) => {
                const color = r === 'tp' ? C.green : r === 'sl' ? C.red : r === 'so' ? '#dc2626' : r === 'user' ? C.blue : C.amber;
                return <Bar key={r} dataKey={r} name={r} stackId="reasons" fill={color} />;
              })}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Tab — Stop Out
// ============================================================================
function StopOutTab({ trades, soEvents, core, cumulative }) {
  const totalSoLoss = _.sumBy(soEvents, 'totalLoss');
  const totalLosses = _.sumBy(trades.filter(t => t.net_pnl < 0), 'net_pnl');
  const avgSoLossPerEvent = soEvents.length ? totalSoLoss / soEvents.length : 0;
  const avgTradesPerEvent = soEvents.length ? _.sumBy(soEvents, 'tradeCount') / soEvents.length : 0;
  const worstSo = _.minBy(soEvents, 'totalLoss');
  const totalDays = trades.length > 1 ? Math.max(1, ((trades[trades.length - 1].close_time - trades[0].close_time) / 86400000)) : 1;
  const soPerMonth = (soEvents.length / totalDays) * 30;
  const soPctOfLosses = totalLosses < 0 ? Math.abs(totalSoLoss / totalLosses) * 100 : 0;

  const eventMarkers = useMemo(() => {
    const tradeIdx = new Map();
    cumulative.forEach((c, i) => tradeIdx.set(c.trade.ticket || `t${i}`, c.idx));
    return soEvents.map(e => {
      const idxs = e.trades.map(t => tradeIdx.get(t.ticket || `t${trades.indexOf(t)}`)).filter(Boolean);
      const idx = idxs.length ? Math.max(...idxs) : null;
      return { idx, totalLoss: e.totalLoss, id: e.id };
    }).filter(e => e.idx);
  }, [soEvents, cumulative, trades]);

  const preSoAnalysis = useMemo(() => {
    return soEvents.map(e => {
      const firstSoTrade = e.trades[0];
      const idx = trades.indexOf(firstSoTrade);
      const prior = idx > 0 ? trades.slice(Math.max(0, idx - 20), idx) : [];
      const wins = prior.filter(t => t.net_pnl > 0).length;
      let consLosses = 0;
      for (let i = prior.length - 1; i >= 0; i--) {
        if (prior[i].net_pnl < 0) consLosses++;
        else break;
      }
      return {
        id: e.id,
        priorCount: prior.length,
        winRate: prior.length ? (wins / prior.length) * 100 : 0,
        avgPnl: prior.length ? _.meanBy(prior, 'net_pnl') : 0,
        consLosses,
      };
    });
  }, [soEvents, trades]);

  const recovery = useMemo(() => {
    const cumByTicket = new Map();
    cumulative.forEach(c => cumByTicket.set(c.trade.ticket || c.trade._row, c));
    return soEvents.map(e => {
      const lastTrade = e.trades[e.trades.length - 1];
      const lastCum = cumByTicket.get(lastTrade.ticket || lastTrade._row);
      if (!lastCum) return { id: e.id, recovered: false, tradesToRecover: null, daysToRecover: null, loss: e.totalLoss };
      const start = lastCum.idx;
      const targetCum = lastCum.cum - e.totalLoss; // cum before the SO
      const after = cumulative.slice(start);
      let recoveryIdx = null;
      for (let i = 0; i < after.length; i++) {
        if (after[i].cum >= targetCum) { recoveryIdx = i; break; }
      }
      if (recoveryIdx == null) return { id: e.id, recovered: false, tradesToRecover: null, daysToRecover: null, loss: e.totalLoss };
      const recoveredTrade = after[recoveryIdx].trade;
      const daysToRecover = lastTrade.close_time && recoveredTrade.close_time
        ? (recoveredTrade.close_time - lastTrade.close_time) / 86400000 : null;
      return { id: e.id, recovered: true, tradesToRecover: recoveryIdx + 1, daysToRecover, loss: e.totalLoss };
    });
  }, [soEvents, cumulative]);

  const bySession = useMemo(() => {
    const counts = _.countBy(soEvents, e => getSession(e.trades[0].open_time) || 'unknown');
    return SESSIONS.map(s => ({ session: s, count: counts[s] || 0 }));
  }, [soEvents]);

  const bySymbolLoss = useMemo(() => {
    const m = {};
    soEvents.forEach(e => e.trades.forEach(t => {
      m[t.symbol] = m[t.symbol] || { symbol: t.symbol, loss: 0, count: 0 };
      m[t.symbol].loss += t.net_pnl;
      m[t.symbol].count++;
    }));
    return Object.values(m).sort((a, b) => a.loss - b.loss);
  }, [soEvents]);

  const buildPrompt = () => `Analyze this trader's Stop Out (margin call) events. A stop out means the broker liquidated positions due to insufficient margin.\n\n` +
    `## SO Summary\n- Total SO events: ${soEvents.length}\n- Total SO loss: ${fmtCurrency(totalSoLoss)}\n- SO loss as % of all losses: ${fmtPct(soPctOfLosses)}\n- Average trades per SO event: ${avgTradesPerEvent.toFixed(1)}\n` +
    `\n## Individual SO Events\n` + soEvents.map(e =>
      `- ${e.id}: ${fmtDateTime(e.start)} | ${e.tradeCount} trades | ${fmtCurrency(e.totalLoss)} | symbols: ${Object.entries(e.symbols).map(([s,n]) => `${s}(${n})`).join(', ')} | lots: ${e.lots.toFixed(2)}`
    ).join('\n') +
    `\n\n## Pre-SO patterns (20 trades before each)\n` + preSoAnalysis.map(p =>
      `- ${p.id}: win rate ${fmtPct(p.winRate)}, avg PnL ${fmtCurrency(p.avgPnl)}, consec losses before SO: ${p.consLosses}`
    ).join('\n') +
    `\n\n## Recovery\n` + recovery.map(r =>
      `- ${r.id}: loss ${fmtCurrency(r.loss)}, ${r.recovered ? `recovered in ${r.tradesToRecover} trades / ${r.daysToRecover ? r.daysToRecover.toFixed(1) + 'd' : '?'}` : 'NOT recovered'}`
    ).join('\n') +
    `\n\nProvide:\n1. Root cause analysis — what's causing the stop outs?\n2. Pattern detection — do SO events follow losing streaks? Concentrated in specific sessions/symbols?\n3. Position sizing critique\n4. 3-5 concrete prevention rules\n5. Severity assessment — what would PnL look like without these SOs?\n\nBe brutally honest. Stop outs are serious risk management failures.`;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><AnalyzeThis buildPrompt={buildPrompt} label="Analyze Stop Outs" /></div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total SO Events" value={soEvents.length} />
        <MetricCard label="Total SO Trades" value={_.sumBy(soEvents, 'tradeCount')} />
        <MetricCard label="Total SO Loss" value={fmtCurrency(totalSoLoss)} color="red" />
        <MetricCard label="SO % of All Losses" value={fmtPct(soPctOfLosses)} color="red" />
        <MetricCard label="Avg Loss per Event" value={fmtCurrency(avgSoLossPerEvent)} color="red" />
        <MetricCard label="Avg Trades per Event" value={avgTradesPerEvent.toFixed(1)} />
        <MetricCard label="Worst SO Event" value={worstSo ? fmtCurrency(worstSo.totalLoss) : '—'} sub={worstSo ? fmtDate(worstSo.start) : null} color="red" />
        <MetricCard label="Frequency" value={`${soPerMonth.toFixed(1)} / month`} />
      </div>

      <Card title="SO event timeline (overlay on cumulative PnL)">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={cumulative}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
            <XAxis dataKey="idx" stroke={C.textMuted} fontSize={11} />
            <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
            <Tooltip content={<TooltipBox formatter={(v) => fmtCurrency(v)} />} />
            <ReferenceLine y={0} stroke={C.textDim} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="cum" name="Cumulative PnL" stroke={core.netPnl >= 0 ? C.green : C.red} strokeWidth={1.5} dot={false} />
            {eventMarkers.map(e => (
              <ReferenceLine key={e.id} x={e.idx} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="2 2" label={{ value: e.id, fill: '#fca5a5', fontSize: 9, position: 'top' }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="SO loss per event">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={soEvents.map(e => ({ id: e.id, loss: e.totalLoss, date: fmtDate(e.start), count: e.tradeCount }))}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="id" stroke={C.textMuted} fontSize={10} />
              <YAxis stroke={C.textMuted} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
              <Tooltip content={<TooltipBox formatter={(v, _n, p) => `${fmtCurrency(v)} on ${p.date} (${p.count} trades)`} />} />
              <Bar dataKey="loss" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="SO events by session">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={bySession}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="session" stroke={C.textMuted} fontSize={10} />
              <YAxis stroke={C.textMuted} fontSize={11} />
              <Tooltip content={<TooltipBox />} />
              <Bar dataKey="count" name="SO events">
                {bySession.map((s, i) => <Cell key={i} fill={SESSION_COLORS[s.session]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="SO loss by symbol">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={bySymbolLoss} layout="vertical">
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis type="number" stroke={C.textMuted} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
              <YAxis dataKey="symbol" type="category" stroke={C.textMuted} fontSize={11} width={80} />
              <Tooltip content={<TooltipBox formatter={(v, _n, p) => `${fmtCurrency(v)} (${p.count} trades)`} />} />
              <Bar dataKey="loss" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Pre-SO pattern (20 trades before each)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 border-b border-slate-700"><tr>
                <th className="text-left px-3 py-2">Event</th>
                <th className="text-left px-3 py-2">Win rate</th>
                <th className="text-left px-3 py-2">Avg PnL</th>
                <th className="text-left px-3 py-2">Consec losses</th>
              </tr></thead>
              <tbody>
                {preSoAnalysis.map(p => (
                  <tr key={p.id} className="border-b border-slate-800">
                    <td className="px-3 py-2 text-white">{p.id}</td>
                    <td className="px-3 py-2" style={{ color: p.winRate >= 50 ? C.green : C.red }}>{fmtPct(p.winRate)}</td>
                    <td className="px-3 py-2" style={{ color: p.avgPnl >= 0 ? C.green : C.red }}>{fmtCurrency(p.avgPnl)}</td>
                    <td className="px-3 py-2 text-amber-400">{p.consLosses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title="SO event details">
        <div className="space-y-3">
          {soEvents.map(e => (
            <div key={e.id} className="rounded-lg border border-red-800/60 bg-red-950/20 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <AlertOctagon size={16} className="text-red-400" />
                  <strong className="text-red-300">{e.id}</strong>
                  <span className="text-slate-400 text-sm">{fmtDateTime(e.start)} UTC</span>
                </div>
                <div className="text-red-400 font-semibold">{fmtCurrency(e.totalLoss)}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-300">
                <div>Trades: <span className="text-white">{e.tradeCount}</span></div>
                <div>Symbols: <span className="text-white">{Object.entries(e.symbols).map(([s, n]) => `${s}(${n})`).join(', ')}</span></div>
                <div>Direction: <span className="text-green-400">{e.buys} buy</span> / <span className="text-red-400">{e.sells} sell</span></div>
                <div>Lots: <span className="text-white">{e.lots.toFixed(2)}</span></div>
                <div>Duration: <span className="text-white">{fmtDuration(e.durationMs)}</span></div>
                <div>Largest single: <span className="text-red-400">{fmtCurrency(e.largestSingleLoss)}</span> {e.largestSingleTicket && <span className="text-slate-500">#{e.largestSingleTicket}</span>}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Recovery analysis">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 border-b border-slate-700"><tr>
              <th className="text-left px-3 py-2">Event</th>
              <th className="text-left px-3 py-2">Loss</th>
              <th className="text-left px-3 py-2">Trades to recover</th>
              <th className="text-left px-3 py-2">Days</th>
              <th className="text-left px-3 py-2">Recovered?</th>
            </tr></thead>
            <tbody>
              {recovery.map(r => (
                <tr key={r.id} className="border-b border-slate-800">
                  <td className="px-3 py-2 text-white">{r.id}</td>
                  <td className="px-3 py-2 text-red-400">{fmtCurrency(r.loss)}</td>
                  <td className="px-3 py-2 text-slate-200">{r.tradesToRecover ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-200">{r.daysToRecover != null ? r.daysToRecover.toFixed(1) : '—'}</td>
                  <td className="px-3 py-2">{r.recovered ? <span className="text-green-400">✓ yes</span> : <span className="text-red-400">✗ not recovered</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// Tab — Time Analysis
// ============================================================================
function TimeTab({ time, trades }) {
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const stackedHold = useMemo(() => time.byBucket.map(b => ({ bucket: b.label, wins: b.wins, losses: b.losses, count: b.count })), [time.byBucket]);

  const buildPrompt = () => `Analyze this trader's schedule and hold times.\n\n` +
    `Hours (top 5 by count):\n` + _.orderBy(time.byHour.filter(h => h.count > 0), ['count'], ['desc']).slice(0, 5).map(h => `- ${h.hour}:00 UTC: ${h.count} trades, avg ${fmtCurrency(h.avgPnl)}`).join('\n') +
    `\n\nDays (top by count):\n` + _.orderBy(time.byDow.filter(d => d.count > 0), ['count'], ['desc']).slice(0, 5).map(d => `- ${d.name}: ${d.count} trades, avg ${fmtCurrency(d.avgPnl)}`).join('\n') +
    `\n\nHold time buckets:\n` + time.byBucket.filter(b => b.count > 0).map(b => `- ${b.label}: ${b.count} trades, win ${fmtPct(b.winRate)}, avg ${fmtCurrency(b.avgPnl)}`).join('\n') +
    `\n\nWhen should the trader trade? When should they avoid? Best/worst hold time category?`;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><AnalyzeThis buildPrompt={buildPrompt} label="Analyze Time" /></div>

      <Card title="Hold-time category — wins vs losses">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={stackedHold}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
            <XAxis dataKey="bucket" stroke={C.textMuted} fontSize={11} />
            <YAxis stroke={C.textMuted} fontSize={11} />
            <Tooltip content={<TooltipBox />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="wins"   stackId="r" fill={C.green} name="Wins" />
            <Bar dataKey="losses" stackId="r" fill={C.red}   name="Losses" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Hold time vs PnL (scatter)">
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="hours" name="Hold (h)" stroke={C.textMuted} fontSize={11} />
              <YAxis type="number" dataKey="pnl"   name="PnL"      stroke={C.textMuted} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
              <Tooltip content={<TooltipBox formatter={(v, n) => n === 'PnL' ? fmtCurrency(v) : `${v.toFixed(1)}h`} />} />
              <ReferenceLine y={0} stroke={C.textDim} strokeDasharray="4 4" />
              <Scatter data={time.scatter} fill={C.blue}>
                {time.scatter.map((p, i) => <Cell key={i} fill={p.win ? C.green : C.red} fillOpacity={0.6} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Trades by day of week">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={time.byDow}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={C.textMuted} fontSize={11} />
              <YAxis yAxisId="left" stroke={C.textMuted} fontSize={11} />
              <YAxis yAxisId="right" orientation="right" stroke={C.amber} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
              <Tooltip content={<TooltipBox formatter={(v, n) => n === 'Avg PnL' ? fmtCurrency(v) : v} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="count" name="Trades" fill={C.blue} />
              <Line yAxisId="right" type="monotone" dataKey="avgPnl" name="Avg PnL" stroke={C.amber} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Trades by hour of day (UTC)">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={time.byHour}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke={C.textMuted} fontSize={11} />
              <YAxis yAxisId="left" stroke={C.textMuted} fontSize={11} />
              <YAxis yAxisId="right" orientation="right" stroke={C.amber} fontSize={11} tickFormatter={(v) => fmtCurrency(v, 0)} />
              <Tooltip content={<TooltipBox formatter={(v, n) => n === 'Avg PnL' ? fmtCurrency(v) : v} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="count" name="Trades" fill={C.blue} />
              <Line yAxisId="right" type="monotone" dataKey="avgPnl" name="Avg PnL" stroke={C.amber} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Hold-time stats">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 border-b border-slate-700"><tr>
                {['Category','Trades','Wins','Losses','Win Rate','Avg PnL'].map(h => <th key={h} className="text-left px-3 py-2">{h}</th>)}
              </tr></thead>
              <tbody>
                {time.byBucket.map(b => (
                  <tr key={b.key} className="border-b border-slate-800">
                    <td className="px-3 py-2 text-white">{b.label}</td>
                    <td className="px-3 py-2 text-slate-200">{b.count}</td>
                    <td className="px-3 py-2 text-green-400">{b.wins}</td>
                    <td className="px-3 py-2 text-red-400">{b.losses}</td>
                    <td className="px-3 py-2" style={{ color: b.winRate >= 50 ? C.green : C.red }}>{fmtPct(b.winRate)}</td>
                    <td className="px-3 py-2" style={{ color: b.avgPnl >= 0 ? C.green : C.red }}>{fmtCurrency(b.avgPnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Tab — Trade Log
// ============================================================================
function TradeLogTab({ trades, mapping }) {
  const PAGE = 50;
  const [page, setPage] = useState(0);
  const [filterSymbol, setFilterSymbol] = useState('all');
  const [filterType,   setFilterType]   = useState('all');
  const [filterReason, setFilterReason] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('close_time');
  const [sortDir, setSortDir] = useState('asc');

  const symbols = useMemo(() => _.uniq(trades.map(t => t.symbol)).sort(), [trades]);
  const types   = useMemo(() => _.uniq(trades.map(t => t.type).filter(Boolean)).sort(), [trades]);
  const reasons = useMemo(() => _.uniq(trades.map(t => t.close_reason).filter(Boolean)).sort(), [trades]);

  const filtered = useMemo(() => {
    let r = trades;
    if (filterSymbol !== 'all') r = r.filter(t => t.symbol === filterSymbol);
    if (filterType   !== 'all') r = r.filter(t => t.type === filterType);
    if (filterReason !== 'all') r = r.filter(t => t.close_reason === filterReason);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(t => String(t.ticket || '').toLowerCase().includes(s));
    }
    r = _.orderBy(r, [t => {
      const v = t[sortKey];
      if (v instanceof Date) return v.getTime();
      if (v == null) return -Infinity;
      return v;
    }], [sortDir]);
    return r;
  }, [trades, filterSymbol, filterType, filterReason, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const filteredPnl = _.sumBy(filtered, 'net_pnl');

  const cols = [
    { key: '_idx',        label: '#',           show: true,                  render: (t, i) => i + 1 + page * PAGE },
    { key: 'ticket',      label: 'Ticket',      show: !!mapping.ticket,      render: t => t.ticket },
    { key: 'open_time',   label: 'Open Time',   show: !!mapping.open_time,   render: t => fmtDateTime(t.open_time) },
    { key: 'close_time',  label: 'Close Time',  show: !!mapping.close_time,  render: t => fmtDateTime(t.close_time) },
    { key: 'symbol',      label: 'Symbol',      show: !!mapping.symbol,      render: t => t.symbol },
    { key: 'type',        label: 'Type',        show: !!mapping.type,        render: t => {
        const c = t.type === 'buy' ? C.green : t.type === 'sell' ? C.red : C.textMuted;
        return <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: c + '33', color: c }}>{t.type || '—'}</span>;
    }},
    { key: 'lots',        label: 'Lots',        show: !!mapping.lots,        render: t => isFinite(t.lots) ? t.lots.toFixed(2) : '—' },
    { key: 'open_price',  label: 'Open',        show: !!mapping.open_price,  render: t => isFinite(t.open_price)  ? fmtNumber(t.open_price, 5) : '—' },
    { key: 'close_price', label: 'Close',       show: !!mapping.close_price, render: t => isFinite(t.close_price) ? fmtNumber(t.close_price, 5) : '—' },
    { key: 'stop_loss',   label: 'SL',          show: !!mapping.stop_loss,   render: t => isFinite(t.stop_loss)   ? fmtNumber(t.stop_loss, 5) : '—' },
    { key: 'take_profit', label: 'TP',          show: !!mapping.take_profit, render: t => isFinite(t.take_profit) ? fmtNumber(t.take_profit, 5) : '—' },
    { key: 'pnl',         label: 'PnL',         show: !!mapping.pnl,         render: t => <span style={{ color: t.pnl >= 0 ? C.green : C.red }}>{fmtCurrency(t.pnl)}</span> },
    { key: 'net_pnl',     label: 'Net PnL',     show: true,                  render: t => <span style={{ color: t.net_pnl >= 0 ? C.green : C.red }}>{fmtCurrency(t.net_pnl)}</span> },
    { key: 'hold_time_ms',label: 'Hold',        show: !!(mapping.open_time && mapping.close_time), render: t => fmtDuration(t.hold_time_ms) },
    { key: 'close_reason',label: 'Reason',      show: !!mapping.close_reason, render: t => {
        if (!t.close_reason) return '—';
        const c = t.close_reason === 'tp' ? C.green : t.close_reason === 'sl' ? C.red : t.close_reason === 'so' ? '#dc2626' : t.close_reason === 'user' ? C.blue : C.amber;
        return <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ background: c + '33', color: c }}>{t.close_reason}</span>;
    }},
  ].filter(c => c.show);

  const sortBy = (k) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-slate-400" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search ticket…"
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white w-40"
            />
          </div>
          <div className="flex items-center gap-1"><Filter size={14} className="text-slate-400" />
            <select value={filterSymbol} onChange={e => { setFilterSymbol(e.target.value); setPage(0); }}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white">
              <option value="all">All symbols</option>
              {symbols.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {types.length > 0 && (
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(0); }}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white">
              <option value="all">All types</option>
              {types.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {reasons.length > 0 && (
            <select value={filterReason} onChange={e => { setFilterReason(e.target.value); setPage(0); }}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white">
              <option value="all">All reasons</option>
              {reasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <div className="ml-auto text-sm text-slate-300">
            <strong className="text-white">{filtered.length.toLocaleString()}</strong> trades •
            <span style={{ color: filteredPnl >= 0 ? C.green : C.red }} className="ml-1 font-semibold">{fmtCurrency(filteredPnl)}</span>
          </div>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 border-b border-slate-700">
              <tr>
                {cols.map(c => (
                  <th key={c.key} className="text-left px-2 py-2 font-medium whitespace-nowrap cursor-pointer select-none" onClick={() => c.key !== '_idx' && sortBy(c.key)}>
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sortKey === c.key && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t, i) => (
                <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/40">
                  {cols.map(c => <td key={c.key} className="px-2 py-1.5 text-slate-200 whitespace-nowrap">{c.render(t, i)}</td>)}
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={cols.length}>No trades match the filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div className="text-xs text-slate-400">Page {page + 1} of {totalPages}</div>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} icon={ChevronLeft}>Prev</Btn>
            <Btn variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} icon={ChevronRight}>Next</Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// Tab — AI Insights (full report + follow-up)
// ============================================================================
function AIInsightsTab({ trades, core, bySymbol, byReason, bySession, soEvents, time, cumulative }) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [followQ, setFollowQ] = useState('');
  const [followLoading, setFollowLoading] = useState(false);
  const [followAnswer, setFollowAnswer] = useState(null);

  const equityShape = useMemo(() => {
    if (cumulative.length < 4) return null;
    const q1 = Math.floor(cumulative.length * 0.25);
    const q3 = Math.floor(cumulative.length * 0.75);
    const startCum = 0, midStart = cumulative[q1].cum, midEnd = cumulative[q3].cum, endCum = cumulative[cumulative.length - 1].cum;
    const trend = (a, b) => Math.abs(b - a) < 0.05 * Math.max(Math.abs(a), Math.abs(b), 1) ? 'flat' : (b > a ? 'up' : 'down');
    return {
      first:  { trend: trend(startCum, midStart), pnl: midStart - startCum },
      middle: { trend: trend(midStart, midEnd),   pnl: midEnd - midStart },
      recent: { trend: trend(midEnd, endCum),     pnl: endCum - midEnd },
    };
  }, [cumulative]);

  const buildContext = useCallback(() => {
    const totalLosses = _.sumBy(trades.filter(t => t.net_pnl < 0), 'net_pnl');
    const soLoss = _.sumBy(soEvents, 'totalLoss');
    const soPct = totalLosses < 0 ? Math.abs(soLoss / totalLosses) * 100 : 0;
    const worst = _.minBy(soEvents, 'totalLoss');
    const topHours = _.orderBy(time.byHour.filter(h => h.count > 0), ['count'], ['desc']).slice(0, 3);
    const topDays  = _.orderBy(time.byDow.filter(d => d.count > 0), ['count'], ['desc']).slice(0, 3);
    const bestBucket  = _.maxBy(time.byBucket.filter(b => b.count > 0), 'avgPnl');
    const worstBucket = _.minBy(time.byBucket.filter(b => b.count > 0), 'avgPnl');

    return [
      `## Core Metrics`,
      `- Total Trades: ${core.total}`,
      `- Win Rate: ${fmtPct(core.winRate)}`,
      `- Net PnL: ${fmtCurrency(core.netPnl)}`,
      `- Profit Factor: ${isFinite(core.profitFactor) ? core.profitFactor.toFixed(2) : 'inf'}`,
      `- Avg Win: ${fmtCurrency(core.avgWin)} | Avg Loss: ${fmtCurrency(core.avgLoss)}`,
      `- R:R Ratio: ${core.rrRatio.toFixed(2)}`,
      `- Expectancy: ${fmtCurrency(core.expectancy)}`,
      `- Max Consecutive Wins: ${core.maxConsWins} | Losses: ${core.maxConsLosses}`,
      ``,
      `## Performance by Symbol`,
      ...bySymbol.map(s => `- ${s.symbol}: ${s.count} trades, win ${fmtPct(s.winRate)}, total ${fmtCurrency(s.totalPnl)}, avg ${fmtCurrency(s.avgPnl)}`),
      ``,
      byReason.length ? `## Close Reason Breakdown` : '',
      ...byReason.map(r => `- ${r.reason}: ${r.count} trades, win ${fmtPct(r.winRate)}, total ${fmtCurrency(r.totalPnl)}, avg ${fmtCurrency(r.avgPnl)}, avg win ${fmtCurrency(r.avgWin)}, avg loss ${fmtCurrency(r.avgLoss)}`),
      ``,
      `## Trading Session Performance`,
      ...bySession.filter(s => s.count > 0).map(s => `- ${s.session}: ${s.count} trades, win ${fmtPct(s.winRate)}, total ${fmtCurrency(s.totalPnl)}, avg ${fmtCurrency(s.avgPnl)}, PF ${isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf'}`),
      ``,
      soEvents.length ? `## Stop Out Events` : '',
      soEvents.length ? `- Total SO events: ${soEvents.length} (clustered)` : '',
      soEvents.length ? `- Total SO loss: ${fmtCurrency(soLoss)}` : '',
      soEvents.length ? `- SO loss as % of all losses: ${fmtPct(soPct)}` : '',
      soEvents.length && worst ? `- Worst single SO event: ${fmtCurrency(worst.totalLoss)} on ${fmtDate(worst.start)}` : '',
      ``,
      `## Time Analysis`,
      `- Most active hours (UTC): ${topHours.map(h => `${h.hour}:00 (${h.count} trades, avg ${fmtCurrency(h.avgPnl)})`).join(', ')}`,
      `- Most active days: ${topDays.map(d => `${d.name} (${d.count} trades, avg ${fmtCurrency(d.avgPnl)})`).join(', ')}`,
      bestBucket ? `- Best hold time: ${bestBucket.label} (win ${fmtPct(bestBucket.winRate)}, avg ${fmtCurrency(bestBucket.avgPnl)})` : '',
      worstBucket ? `- Worst hold time: ${worstBucket.label} (win ${fmtPct(worstBucket.winRate)}, avg ${fmtCurrency(worstBucket.avgPnl)})` : '',
      ``,
      equityShape ? `## Equity Curve Shape` : '',
      equityShape ? `- First 25%: ${equityShape.first.trend} (${fmtCurrency(equityShape.first.pnl)})` : '',
      equityShape ? `- Middle 25-75%: ${equityShape.middle.trend} (${fmtCurrency(equityShape.middle.pnl)})` : '',
      equityShape ? `- Recent 25%: ${equityShape.recent.trend} (${fmtCurrency(equityShape.recent.pnl)})` : '',
    ].filter(Boolean).join('\n');
  }, [core, bySymbol, byReason, bySession, soEvents, time, equityShape, trades]);

  const generate = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const prompt = `You are an expert trading analyst. Analyze this trader's performance data and provide actionable insights.\n\n${buildContext()}\n\n` +
        `Please provide:\n` +
        `1. **Overall Assessment**: Is this trader profitable? What's the trading style? (2-3 sentences)\n` +
        `2. **Top 3 Strengths**: What's working well, backed by the numbers\n` +
        `3. **Top 3 Weaknesses**: What needs improvement, backed by the numbers\n` +
        `4. **Close Reason Analysis**: Are stop losses too tight/wide? Manual closes helping or hurting? TP optimized?\n` +
        `5. **Session Analysis**: Which sessions to focus on? Avoid? Session-symbol edges?\n` +
        `6. **Stop Out Risk Assessment**: Severity, causes, rules to implement\n` +
        `7. **Time-Based Patterns**: Session/day advantages? Avoid certain times?\n` +
        `8. **Risk Management Score** (1-10): based on R:R, profit factor, max consecutive losses, stop-out frequency, position sizing\n` +
        `9. **Specific Actionable Recommendations**: 5-7 concrete things to do differently, prioritized by impact\n\n` +
        `Format your response in clear sections with headers. Be direct and specific — reference the actual numbers. Do not be generic. If something is bad, say it clearly.`;
      const text = await callLLM(prompt);
      setReport(text);
    } catch (e) {
      setError(e.message || 'Request failed');
    } finally { setLoading(false); }
  }, [buildContext]);

  const askFollowUp = useCallback(async () => {
    if (!followQ.trim()) return;
    setFollowLoading(true); setFollowAnswer(null);
    try {
      const prompt = `Trader asks a specific question about their data:\n\n"${followQ.trim()}"\n\nUse this metrics context to answer (be specific, reference numbers):\n\n${buildContext()}`;
      const text = await callLLM(prompt);
      setFollowAnswer(text);
    } catch (e) {
      setFollowAnswer(`Error: ${e.message || 'Request failed'}`);
    } finally { setFollowLoading(false); }
  }, [followQ, buildContext]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Brain size={20} className="text-blue-400" /> AI Trading Analysis</h3>
            <p className="text-sm text-slate-400 mt-1">Sends aggregated metrics (never raw trades) to Claude for personalized analysis.</p>
          </div>
          <div className="flex gap-2">
            {report && <Btn variant="ghost" icon={RefreshCw} onClick={generate} disabled={loading}>Regenerate</Btn>}
            {!report && <Btn variant="primary" icon={Sparkles} onClick={generate} disabled={loading}>Generate AI Analysis</Btn>}
          </div>
        </div>
      </Card>

      {loading && (
        <Card><div className="flex items-center gap-3 text-slate-300"><RefreshCw size={16} className="animate-spin text-blue-400" />Analyzing your trading data…</div></Card>
      )}
      {error && (
        <Card><div className="text-red-400">{error}<div className="mt-2"><Btn variant="ghost" onClick={generate} icon={RefreshCw}>Retry</Btn></div></div></Card>
      )}
      {report && (
        <Card title="Analysis report"><MarkdownView text={report} /></Card>
      )}

      <Card title="Ask a follow-up question">
        <div className="flex items-center gap-2">
          <input
            value={followQ}
            onChange={(e) => setFollowQ(e.target.value)}
            placeholder="e.g. Should I keep trading XAUUSD on Fridays?"
            className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white"
          />
          <Btn variant="primary" icon={Send} onClick={askFollowUp} disabled={!followQ.trim() || followLoading}>Ask</Btn>
        </div>
        {followLoading && <div className="mt-3 text-slate-300 flex items-center gap-2"><RefreshCw size={14} className="animate-spin" />Thinking…</div>}
        {followAnswer && <div className="mt-4 p-3 bg-slate-900/60 rounded border border-slate-700"><MarkdownView text={followAnswer} /></div>}
      </Card>
    </div>
  );
}

// ============================================================================
// Dashboard
// ============================================================================
function Dashboard({ trades, mapping, fileName, onReset }) {
  const [tab, setTab] = useState('overview');

  const core       = useMemo(() => computeCoreMetrics(trades), [trades]);
  const bySymbol   = useMemo(() => computeBySymbol(trades), [trades]);
  const byReason   = useMemo(() => computeByCloseReason(trades), [trades]);
  const bySession  = useMemo(() => computeBySession(trades), [trades]);
  const soEvents   = useMemo(() => groupSOEvents(trades), [trades]);
  const cumulative = useMemo(() => computeCumulative(trades), [trades]);
  const histogram  = useMemo(() => computeHistogram(trades), [trades]);
  const time       = useMemo(() => computeTimeAnalysis(trades), [trades]);

  const dateRange = useMemo(() => {
    const ds = trades.map(t => t.close_time || t.open_time).filter(Boolean);
    return ds.length ? { start: _.min(ds), end: _.max(ds) } : null;
  }, [trades]);

  const hasCloseReason = !!mapping.close_reason;
  const hasSO          = soEvents.length > 0;
  const hasSession     = !!mapping.open_time;

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3, show: true },
    { id: 'closereason', label: 'Close Reason', icon: Target, show: hasCloseReason },
    { id: 'sessions', label: 'Trading Sessions', icon: Clock, show: hasSession },
    { id: 'so', label: 'Stop Out', icon: AlertOctagon, show: hasSO },
    { id: 'time', label: 'Time Analysis', icon: Clock, show: true },
    { id: 'log', label: 'Trade Log', icon: FileText, show: true },
    { id: 'ai', label: 'AI Insights', icon: Brain, show: true },
  ].filter(t => t.show);

  return (
    <div className="min-h-screen" style={{ background: C.bg }}>
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b border-slate-700 bg-slate-900/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUp size={20} className="text-blue-400" />
            <div>
              <div className="text-white font-semibold">Trading Statistics Dashboard</div>
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <FileText size={11} />
                <span className="font-mono">{fileName}</span>
              </div>
            </div>
          </div>
          <Btn variant="ghost" icon={FileUp} onClick={onReset}>Import New File</Btn>
        </div>
      </div>

      {/* Summary banner */}
      <div className="border-b border-slate-700 bg-slate-800/40">
        <div className="max-w-7xl mx-auto px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><span className="text-slate-400">Date range</span><div className="text-white font-medium">{dateRange ? `${fmtDate(dateRange.start)} – ${fmtDate(dateRange.end)}` : '—'}</div></div>
          <div><span className="text-slate-400">Total trades</span><div className="text-white font-medium">{core.total.toLocaleString()}</div></div>
          <div><span className="text-slate-400">Net PnL</span><div className="font-semibold" style={{ color: core.netPnl >= 0 ? C.green : C.red }}>{fmtCurrency(core.netPnl)}</div></div>
          <div><span className="text-slate-400">Win rate</span><div className="text-white font-medium">{fmtPct(core.winRate)}</div></div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="border-b border-slate-700 bg-slate-900/60">
        <div className="max-w-7xl mx-auto px-4 flex overflow-x-auto">
          {tabs.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors
                  ${active ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}>
                <Icon size={15} />{t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-5">
        {tab === 'overview'    && <OverviewTab trades={trades} core={core} bySymbol={bySymbol} cumulative={cumulative} histogram={histogram} />}
        {tab === 'closereason' && <CloseReasonTab trades={trades} byReason={byReason} core={core} />}
        {tab === 'sessions'    && <SessionsTab bySession={bySession} core={core} hasCloseReason={hasCloseReason} trades={trades} />}
        {tab === 'so'          && <StopOutTab trades={trades} soEvents={soEvents} core={core} cumulative={cumulative} />}
        {tab === 'time'        && <TimeTab time={time} trades={trades} />}
        {tab === 'log'         && <TradeLogTab trades={trades} mapping={mapping} />}
        {tab === 'ai'          && <AIInsightsTab trades={trades} core={core} bySymbol={bySymbol} byReason={byReason} bySession={bySession} soEvents={soEvents} time={time} cumulative={cumulative} />}
      </div>
    </div>
  );
}

// ============================================================================
// Main App
// ============================================================================
export default function TradingDashboardApp() {
  const [step, setStep]   = useState(1);
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [tzOffsetHours, setTzOffsetHours] = useState(0);
  const [data, setData] = useState(null);

  const reset = useCallback(() => {
    setStep(1); setParsed(null); setMapping(null); setTzOffsetHours(0); setData(null);
  }, []);

  const loadSample = useCallback(() => {
    const trades = generateSampleData();
    setData({ trades, mapping: SAMPLE_MAPPING_FOR_DISPLAY, fileName: 'sample-data.csv (generated)' });
  }, []);

  if (data) {
    return <Dashboard trades={data.trades} mapping={data.mapping} fileName={data.fileName} onReset={reset} />;
  }

  return (
    <div className="min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <TrendingUp size={24} className="text-blue-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Trading Statistics Dashboard</h1>
              <div className="text-xs text-slate-400">Upload your CSV from any broker for full statistical breakdown + AI insights</div>
            </div>
          </div>
          {step !== 1 && (
            <Btn variant="ghost" icon={RotateCcw} onClick={reset}>Start over</Btn>
          )}
        </div>

        <div className="mb-6"><Stepper step={step} /></div>

        {step === 1 && (
          <StepUpload
            onParsed={(p) => { setParsed(p); setStep(2); }}
            onSample={loadSample}
          />
        )}
        {step === 2 && parsed && (
          <StepMapping
            parsed={parsed}
            onConfirm={(m, tz) => { setMapping(m); setTzOffsetHours(tz); setStep(3); }}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && parsed && mapping && (
          <StepClean
            parsed={parsed}
            mapping={mapping}
            tzOffsetHours={tzOffsetHours}
            onLaunch={({ trades, mapping: inv }) => setData({ trades, mapping: inv, fileName: parsed.fileName })}
            onBack={() => setStep(2)}
          />
        )}
      </div>
    </div>
  );
}
