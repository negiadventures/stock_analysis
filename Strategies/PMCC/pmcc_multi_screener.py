#!/usr/bin/env python3
"""
PMCC Multi-Ticker Screener (NASDAQ API)

- For each ticker:
  1) Fetch LEAPS candidates (deep ITM calls, far-dated) and near-term OTM short calls
  2) Enrich with Greeks via per-contract detail endpoint
  3) Filter by deltas/IV and rank
  4) Build ALL combinations across chosen LEAPS & Shorts
- Aggregate ALL tickers' combos and rank globally by:
    metric1 (default): ((short_strike)/(leap_strike)) * 100   <-- your requested ranking
  Also provides:
    metric2: (short_mid / leap_mid) * 100                     <-- premium % of LEAPS cost

Outputs CSV/Excel if requested.



python pmcc_multi_screener.py \
  --tickers TSLA,QQQ \
  --leaps-from 2027-01-01 --leaps-to 2027-12-31 \
  --shorts-from 2025-09-18 --shorts-to 2025-10-20 \
  --max-leaps-iv 2.0 \
  --early-close-buffer .30 \
  --target-delta-low 0.75 --target-delta-high 0.85 \
  --short-delta-low 0.25 --short-delta-high 0.50 \
  --min-cushion-pct 2.5 \
  --top-n-leaps 5 --top-n-shorts 5 \
  --sort metric2 \
  --excel pmcc_global_candidates.xlsx

for stocks, assetclass=stocks in url
for ETFs, assetclass=etf in url
"""

import re
import math
import argparse
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Tuple, List

import requests
import pandas as pd

assetclass = "stocks"
NASDAQ_BASE = "https://api.nasdaq.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                  " AppleWebKit/537.36 (KHTML, like Gecko)"
                  " Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}
# ---------------------------
# Helpers
# ---------------------------
def parse_money(value: str) -> Optional[float]:
    if value is None: return None
    s = str(value).strip().replace("$","").replace(",","")
    if s in ("--","-",""): return None
    try: return float(s)
    except: return None

def fetch_json(url: str, params: dict=None) -> dict:
    r = requests.get(url, headers=HEADERS, params=params, timeout=25)
    r.raise_for_status()
    return r.json()

def fetch_chain(ticker: str, fromdate: str, todate: str,
                callput: str="call", money: str="all", limit: int=500) -> Tuple[pd.DataFrame, Optional[float]]:
    global assetclass
    url = f"{NASDAQ_BASE}/api/quote/{ticker}/option-chain"
    params = {
        "assetclass": assetclass,
        "limit": str(limit),
        "fromdate": fromdate,
        "todate": todate,
        "excode": "oprac",
        "callput": callput,    # call/put/all
        "money": money,        # in/out/all
        "type": "all",
    }
    js = fetch_json(url, params=params)
    if js.get("data", {}) is None:
        assetclass = "etf"
        params["assetclass"] = assetclass
        js = fetch_json(url, params=params)
    time.sleep(0.5)
    rows = []
    spot = 0
    if js.get("data", {}).get("totalRecord") > 0:
        rows = (js or {}).get("data", {}).get("table", {}).get("rows", []) or []
        last_trade_raw = (js or {}).get("data", {}).get("lastTrade", "")
        m = re.search(r"\$([0-9]+\.[0-9]+)", last_trade_raw or "")
        if m:
            spot = float(m.group(1))
        else:
            m = re.search(r"\$([0-9]+)", last_trade_raw or "")
            if m:
                spot = float(m.group(1))

    recs = []
    expiry = ""
    for r in rows:
        if r.get("expirygroup") is not None and r.get("expirygroup") != "":
            expiry = r.get("expirygroup")
        else:
            recs.append({
                "expiryDate": expiry,
                "strike": parse_money(r.get("strike")),
                "bid": parse_money(r.get("c_Bid")),
                "ask": parse_money(r.get("c_Ask")),
                "last": parse_money(r.get("c_Last")),
                "volume": 0 if (r.get("c_Volume") in (None,"--")) else int(str(r.get("c_Volume")).replace(",","")),
                "openInterest": 0 if (r.get("c_Openinterest") in (None,"--")) else int(str(r.get("c_Openinterest")).replace(",","")),
                "detail_path": r.get("drillDownURL"),
            })
    df = pd.DataFrame(recs)
    if not df.empty:
        df["mid"] = (df["bid"].fillna(0) + df["ask"].fillna(0)) / 2
    return df, spot

def fetch_greeks(ticker, detail_path: str) -> Dict[str, Optional[float]]:
    global assetclass
    url = f"{NASDAQ_BASE}{detail_path}".replace(f"https://api.nasdaq.com/market-activity/{assetclass}/{ticker.lower()}/option-chain/call-put-options/", f"https://api.nasdaq.com/api/quote/{ticker.lower()}/option-chain?assetclass={assetclass}&recordID=")
    js = fetch_json(url)
    time.sleep(1)
    data = (js or {}).get("data", {})
    greeks = (data.get("optionChainCallData") or {}).get("optionChainGreeksList") or {}
    # print('greeks', greeks)
    def f(key: str) -> Optional[float]:
        v = greeks.get(key, {}).get("value")
        try: return float(v)
        except: return None

    return {
        "delta": f("Delta"),
        "gamma": f("Gamma"),
        "theta": f("Theta"),
        "vega":  f("Vega"),
        "iv":    f("Impvol"),
    }

def add_greeks(ticker, df: pd.DataFrame) -> pd.DataFrame:
    if df.empty: return df
    out = df.copy()
    for col in ("delta","gamma","theta","vega","iv"):
        out[col] = None
    for idx, row in out.iterrows():
        path = row.get("detail_path")
        if not path: continue
        try:
            g = fetch_greeks(ticker, path)
            for k, v in g.items():
                out.at[idx, k] = v
        except Exception as e:
            # keep Nones on failures
            print(e)
            pass
    return out

def within_days(expiry_text: str, now: datetime, min_days: int, max_days: Optional[int] = None) -> bool:
    """Return True if expiry is between min_days and max_days from now."""
    if not expiry_text or str(expiry_text).strip().lower() in ("none", "--", ""):
        return False

    expiry_text = str(expiry_text).strip()
    dt = None

    # Try known formats
    date_formats = [
        # "%b %d, %Y",  # Oct 17, 2025
        # "%b %d %Y",  # Oct 17 2025
        "%B %d, %Y"  # October 17, 2025
        # "%B %d %Y",  # October 17 2025
        # "%Y-%m-%d",  # 2025-10-17
        # "%b %d",  # Oct 17
        # "%B %d"  # October 17
    ]
    for fmt in date_formats:
        try:
            if fmt == "%b %d":
                # Append year
                dt = datetime.strptime(f"{expiry_text} {now.year}", "%b %d %Y")
                # If already passed, assume next year
                if dt < now:
                    dt = dt.replace(year=dt.year + 1)
            else:
                dt = datetime.strptime(expiry_text, fmt)
                # print(dt)
            break
        except ValueError:
            continue

    if not dt:
        return False

    days = (dt - now).days
    if max_days is None:
        return days >= min_days
    return min_days <= days <= max_days
# ---------------------------
# Config & scoring
# ---------------------------
@dataclass
class PMCCSelectionConfig:
    # LEAPS filters
    target_leaps_delta_low: float = 0.75
    target_leaps_delta_high: float = 0.85
    max_leaps_iv: float = 0.50        # relax for high-vol tickers like TSLA
    min_days_to_expiry: int = 365     # ~12 months
    min_cushion_pct: float = 2.5

    # Short call filters
    short_min_days: int = 25
    short_max_days: int = 50
    short_delta_low: float = 0.25
    short_delta_high: float = 0.40
    early_close_buffer: float = 0.30


def score_leaps_row(row, cfg: PMCCSelectionConfig) -> float:
    delta = float(row.get("delta") or 0.0)
    iv = float(row.get("iv") or 1.0)
    bid = float(row.get("bid") or 0.0)
    ask = float(row.get("ask") or 0.0)
    spr = (ask - bid) / ask if (ask and ask>0) else 1.0
    vol = int(row.get("volume") or 0)
    oi  = int(row.get("openInterest") or 0)
    liq = min(1.0, (vol + oi) / 5000.0)

    delta_score  = 1.0 - min(1.0, abs(delta - 0.80) / 0.20)   # closer to 0.8 better
    iv_score     = 1.0 - min(1.0, iv / max(cfg.max_leaps_iv, 1e-6))  # lower better
    spread_score = 1.0 - min(1.0, spr)                        # tighter better
    liq_score    = liq

    # weights
    return 0.5*delta_score + 0.2*iv_score + 0.2*spread_score + 0.1*liq_score

# ---------------------------
# Per-ticker candidate selection
# ---------------------------
def select_candidates_for_ticker(ticker: str,
                                 leaps_from: str, leaps_to: str,
                                 shorts_from: str, shorts_to: str,
                                 cfg: PMCCSelectionConfig,
                                 top_n_leaps: int,
                                 top_n_shorts: int) -> Tuple[pd.DataFrame, pd.DataFrame, float]:
    leaps_df, spot1  = fetch_chain(ticker, leaps_from,  leaps_to,  callput="call", money="in")
    # print(leaps_df)
    shorts_df, spot2 = fetch_chain(ticker, shorts_from, shorts_to, callput="call", money="out")
    # print(shorts_df)
    spot = spot1 or spot2
    if spot is None:
        raise RuntimeError(f"{ticker}: Could not parse spot from NASDAQ response.")

    now = datetime.utcnow()
    if not leaps_df.empty:
        leaps_df = leaps_df[leaps_df["expiryDate"].apply(lambda x: within_days(str(x), now, cfg.min_days_to_expiry))]
    if not shorts_df.empty:
        shorts_df = shorts_df[shorts_df["expiryDate"].apply(lambda x: within_days(str(x), now, cfg.short_min_days, cfg.short_max_days))]

    leaps_df  = add_greeks(ticker, leaps_df)
    shorts_df = add_greeks(ticker, shorts_df)

    if not leaps_df.empty:
        leaps_df = leaps_df[
            leaps_df["delta"].astype(float).between(cfg.target_leaps_delta_low, cfg.target_leaps_delta_high, inclusive="both")
            & (leaps_df["iv"].astype(float) <= cfg.max_leaps_iv)
        ].copy()
        if not leaps_df.empty:
            leaps_df["score"] = leaps_df.apply(lambda r: score_leaps_row(r, cfg), axis=1)
            leaps_df = leaps_df.sort_values(["score"], ascending=False).head(top_n_leaps)

    if not shorts_df.empty:
        shorts_df = shorts_df[
            shorts_df["delta"].astype(float).between(cfg.short_delta_low, cfg.short_delta_high, inclusive="both")
        ].copy()
        if not shorts_df.empty:
            shorts_df = shorts_df.sort_values(by=["mid","iv","delta"], ascending=[False, False, True]).head(top_n_shorts)
    # tag ticker
    if not leaps_df.empty:
        leaps_df["ticker"]  = ticker
        leaps_df["spot"] = spot
    if not shorts_df.empty:
        shorts_df["ticker"] = ticker
        shorts_df["spot"] = spot
    print(leaps_df)
    print(shorts_df)
    return leaps_df.reset_index(drop=True), shorts_df.reset_index(drop=True), spot

# ---------------------------
# Build ALL combinations across tickers
# ---------------------------
def build_combos(
    all_leaps: List[pd.DataFrame],
    all_shorts: List[pd.DataFrame],
    sort_key: str = "metric2",
    early_close_buffer: float = 0.30,  # $ per contract you assume to close ITM short near expiry
    min_cushion_pct : float = 2.5
) -> pd.DataFrame:
    """
    Combine per-ticker LEAPS with same-ticker SHORTS only (PMCC).
    Adds practical metrics and sorts by metric2 by default (premium % of LEAPS price).

    Requires each per-ticker df to include a 'spot' column (same value for all rows).
    """
    rows = []
    for leaps_df in all_leaps:
        if leaps_df.empty:
            continue
        ticker = leaps_df["ticker"].iloc[0]
        # Find matching shorts df for the same ticker
        match = [s for s in all_shorts if (not s.empty and s["ticker"].iloc[0] == ticker)]
        if not match:
            continue
        shorts_df = match[0]

        spot = float(leaps_df.get("spot", [float("nan")])[0]) if "spot" in leaps_df.columns else float("nan")

        for _, L in leaps_df.iterrows():
            leap_mid   = float(L.get("mid") or 0.0)
            leap_strk  = float(L.get("strike") or 0.0)
            leap_delta = float(L.get("delta") or 0.0)
            leap_iv    = float(L.get("iv") or 0.0)
            leap_exp   = L.get("expiryDate")

            if leap_mid <= 0 or leap_strk <= 0:
                continue

            # Current LEAPS intrinsic and % of price
            leap_intrinsic = max((spot - leap_strk), 0.0) if not math.isnan(spot) else float("nan")
            intrinsic_pct_of_price = (leap_intrinsic / leap_mid) * 100.0 if leap_mid > 0 and not math.isnan(leap_intrinsic) else float("nan")

            for _, S in shorts_df.iterrows():
                short_mid   = float(S.get("mid") or 0.0)
                short_strk  = float(S.get("strike") or 0.0)
                short_delta = float(S.get("delta") or 0.0)
                short_iv    = float(S.get("iv") or 0.0)
                short_exp   = S.get("expiryDate")

                if short_mid <= 0 or short_strk <= 0:
                    continue

                # Your preferred ranking: metric2 (monthly premium as % of LEAPS price)
                metric2 = (short_mid / leap_mid) * 100.0 if leap_mid > 0 else float("nan")

                # Net debit (opening cash outlay per spread)
                net_debit = (leap_mid - short_mid)  # option prices are per share; *100 later if you want $ per contract

                # Cushion to short strike (%)
                cushion_pct = ((short_strk - spot) / spot) * 100.0 if not math.isnan(spot) and spot > 0 else float("nan")

                # ITM-close scenario P/L (close both legs near short strike; short intrinsic ~0 at K_short, pay buffer)
                # P/L per spread in $ = [ (short_strk - leap_strk) - buffer + short_mid - leap_mid ] * 100
                itm_close_pl_per_spread = ((short_strk - leap_strk) - early_close_buffer + short_mid - leap_mid) * 100.0

                # ROI on net debit for that scenario
                roi_itm_close_pct = (itm_close_pl_per_spread / (net_debit * 100.0)) * 100.0 if net_debit > 0 else float("nan")
                if cushion_pct > min_cushion_pct:
                    rows.append({
                        "ticker": ticker,
                        "spot": spot,

                        # LEAPS leg
                        "leap_expiry": leap_exp,
                        "leap_strike": leap_strk,
                        "leap_mid": leap_mid,
                        "leap_delta": leap_delta,
                        "leap_iv": leap_iv,
                        "leap_intrinsic_now": leap_intrinsic,
                        "leap_intrinsic_pct_of_price": intrinsic_pct_of_price,

                        # Short leg
                        "short_expiry": short_exp,
                        "short_strike": short_strk,
                        "short_mid": short_mid,
                        "short_delta": short_delta,
                        "short_iv": short_iv,

                        # Safety / structure
                        "cushion_to_short_strike_pct": cushion_pct,  # distance from spot to short strike

                        # P&L approximations
                        "net_debit_per_spread": net_debit,           # in option points; $ *100 per contract
                        "itm_close_pl_per_spread_$": itm_close_pl_per_spread,
                        "itm_close_roi_pct_on_net": roi_itm_close_pct,

                        # Ranking metric
                        "metric2_premium_over_leap_price_pct": metric2,
                    })

    combos = pd.DataFrame(rows)
    if combos.empty:
        return combos

    # Sort
    if sort_key == "metric2":
        combos = combos.sort_values(
            by=["metric2_premium_over_leap_price_pct", "short_mid"],
            ascending=[False, False]
        )
    else:
        # Fallback secondary sort ideas if you pass other keys:
        combos = combos.sort_values(
            by=["itm_close_roi_pct_on_net", "metric2_premium_over_leap_price_pct"],
            ascending=[False, False]
        )
    combos = combos.reset_index(drop=True)
    return combos

# ---------------------------
# CLI
# ---------------------------
def main():
    ap = argparse.ArgumentParser(description="PMCC multi-ticker screener & global ranker (NASDAQ API)")
    ap.add_argument("--tickers", type=str, required=True,
                    help="Comma-separated tickers, e.g. TSLA,AAPL,MSFT")
    ap.add_argument("--early-close-buffer", type=float, default=0.30,
                    help="Extra $ per share to pay when closing ITM short near expiry")
    ap.add_argument("--leaps-from", type=str, required=True, help="YYYY-MM-DD start for LEAPS")
    ap.add_argument("--leaps-to",   type=str, required=True, help="YYYY-MM-DD end for LEAPS")
    ap.add_argument("--shorts-from", type=str, required=True, help="YYYY-MM-DD start for near-term shorts")
    ap.add_argument("--shorts-to",   type=str, required=True, help="YYYY-MM-DD end for near-term shorts")

    ap.add_argument("--max-leaps-iv", type=float, default=0.50)
    ap.add_argument("--target-delta-low",  type=float, default=0.75)
    ap.add_argument("--target-delta-high", type=float, default=0.85)
    ap.add_argument("--short-delta-low",   type=float, default=0.25)
    ap.add_argument("--short-delta-high",  type=float, default=0.40)
    ap.add_argument("--min-cushion-pct", type = float, default=2.5)

    ap.add_argument("--top-n-leaps",  type=int, default=8)
    ap.add_argument("--top-n-shorts", type=int, default=10)

    ap.add_argument("--sort", choices=["metric1","metric2"], default="metric1",
                    help="metric1 = (short_strike/leap_strike)*100 (default), metric2 = (short_mid/leap_mid)*100")
    ap.add_argument("--excel", type=str, default="", help="If set, save results to this Excel file")
    ap.add_argument("--csv", type=str, default="", help="If set, save results to this CSV file")
    args = ap.parse_args()

    cfg = PMCCSelectionConfig(
        target_leaps_delta_low=args.target_delta_low,
        target_leaps_delta_high=args.target_delta_high,
        max_leaps_iv=args.max_leaps_iv,
        short_delta_low=args.short_delta_low,
        short_delta_high=args.short_delta_high,
        early_close_buffer= args.early_close_buffer,
        min_cushion_pct = args.min_cushion_pct
    )

    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    all_leaps: List[pd.DataFrame] = []
    all_shorts: List[pd.DataFrame] = []

    for t in tickers:
        print(f"\n=== Processing {t} ===")
        leaps_df, shorts_df, spot = select_candidates_for_ticker(
            ticker=t,
            leaps_from=args.leaps_from, leaps_to=args.leaps_to,
            shorts_from=args.shorts_from, shorts_to=args.shorts_to,
            cfg=cfg,top_n_leaps=args.top_n_leaps,
    top_n_shorts=args.top_n_shorts
        )
        if leaps_df.empty:
            print(f"{t}: No LEAPS candidates after filtering.")
        else:
            print(f"{t}: LEAPS candidates: {len(leaps_df)}")
        if shorts_df.empty:
            print(f"{t}: No SHORT candidates after filtering.")
        else:
            print(f"{t}: SHORT candidates: {len(shorts_df)}")

        all_leaps.append(leaps_df)
        all_shorts.append(shorts_df)

    combos = build_combos(all_leaps, all_shorts, sort_key=args.sort, early_close_buffer=cfg.early_close_buffer, min_cushion_pct = cfg.min_cushion_pct)
    if combos.empty:
        print("\nNo combos found. Consider widening date windows or relaxing filters.")
        return

    print("\n=== Global PMCC Combos (ranked) ===")
    cols = [
    "ticker","spot",
    "leap_expiry","leap_strike","leap_mid","leap_delta","leap_iv",
    "short_expiry","short_strike","short_mid","short_delta","short_iv",
    "metric2_premium_over_leap_price_pct",
    "leap_intrinsic_now","leap_intrinsic_pct_of_price",
    "cushion_to_short_strike_pct",
    "net_debit_per_spread","itm_close_pl_per_spread_$","itm_close_roi_pct_on_net",
    ]
    print(combos[cols].to_string(index=False))

    if args.excel:
        with pd.ExcelWriter(args.excel) as writer:
            combos.to_excel(writer, sheet_name="Combos", index=False)
        print(f"\nSaved Excel to {args.excel}")
    if args.csv:
        combos.to_csv(args.csv, index=False)
        print(f"Saved CSV to {args.csv}")

if __name__ == "__main__":
    main()
