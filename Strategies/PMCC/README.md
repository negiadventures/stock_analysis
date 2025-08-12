# PMCC Multi‑Ticker Screener (NASDAQ API)

This tool finds Poor Man’s Covered Call (PMCC) candidates across multiple tickers:

- Pulls LEAPS (deep ITM, far‑dated calls) and near‑term OTM short calls
- Enriches with Greeks from the per‑contract detail endpoint
- Filters/ranks per your rules (delta/IV/windows)
- Builds all LEAPS × Short combos per ticker
- Ranks globally by monthly premium as % of LEAPS price (your preferred metric)

It also estimates a realistic “close-ITM” P/L scenario using an early_close_buffer to account for residual time value you’ll pay to close an ITM short near expiry.

---

## Quick start

**Install:**
```bash
python -m pip install requests pandas openpyxl
```

**Run (example):**
```bash
python pmcc_multi_screener.py   --tickers ATYR   --leaps-from 2026-12-01 --leaps-to 2027-12-31   --shorts-from 2025-09-05 --shorts-to 2025-10-20   --max-leaps-iv 2.0   --early-close-buffer 0.30   --target-delta-low 0.7 --target-delta-high 0.95   --short-delta-low 0.15 --short-delta-high 0.7   --top-n-leaps 6 --top-n-shorts 8   --sort metric2   --excel pmcc_global_candidates.xlsx
```

Tip: For small/high‑vol names, set a higher --max-leaps-iv (e.g., 1.5–2.5). IV values are decimals (1.50 = 150%).

---

## What the script does (in plain English)

1. Downloads option chains (LEAPS window and short‑term window) from NASDAQ for each ticker you pass.
2. Grabs Greeks per contract via the detail API.
3. Filters:
   - LEAPS: delta in your range (e.g., 0.75–0.85), IV ≤ --max-leaps-iv, far‑dated (min DTE threshold)
   - Shorts: near‑term (e.g., 25–50 DTE), delta in your range (e.g., 0.25–0.40)
4. Ranks the LEAPS and short lists per ticker.
5. Combines each ticker’s top LEAPS with that ticker’s top short calls to make PMCC combos.
6. Computes metrics, including:
   - Monthly premium % of LEAPS price (your main ranking metric)
   - Intrinsic value of LEAPS now
   - P/L if the short ends ITM and you close both (with buffer)
   - ROI in that ITM scenario
   - Cushion from spot to the short strike
7. Outputs to console and (optionally) to Excel / CSV.

---

## Command‑line arguments

- `--tickers` comma‑separated list, e.g. TSLA,AAPL,MSFT
- `--leaps-from --leaps-to` search window for LEAPS expiries (YYYY‑MM‑DD)
- `--shorts-from --shorts-to` window for near‑term short calls (YYYY‑MM‑DD)
- `--max-leaps-iv` cap for LEAPS IV (decimal); raise for high‑vol tickers
- Delta filters
  - LEAPS: `--target-delta-low` / `--target-delta-high`
  - Shorts: `--short-delta-low` / `--short-delta-high`
- `--top-n-leaps`, `--top-n-shorts` how many per‑ticker to keep before making combos
- `--sort` choose `metric2` (premium % of LEAPS price, recommended)
- `--early-close-buffer` extra $ per share you expect to pay to close an ITM short near expiry (defaults to 0.30 = $30/contract). Use higher values for volatile/illiquid names.
- `--excel` and/or `--csv` to save results

---

## Excel output: column glossary

Each row is one PMCC combo (a LEAPS + a short call on the same ticker).

Basic info
- ticker – the stock symbol
- spot – the latest spot parsed from NASDAQ’s header for that ticker

LEAPS leg
- leap_expiry – expiration date of the LEAPS
- leap_strike – strike of the LEAPS
- leap_mid – midpoint price of the LEAPS
- leap_delta – sensitivity; ~0.8 acts like ~80 shares
- leap_iv – LEAPS implied volatility (decimal)
- leap_intrinsic_now – how much the LEAPS is ITM right now
- leap_intrinsic_pct_of_price – percent of the LEAPS price that’s intrinsic

Short leg
- short_expiry – expiration date for the short call
- short_strike – strike you’d sell
- short_mid – midpoint premium you’d receive
- short_delta – short call’s delta
- short_iv – short call’s implied volatility

Safety / structure
- cushion_to_short_strike_pct – % distance from spot to short strike

P&L approximations
- net_debit_per_spread – LEAPS mid − short mid (per share)
- itm_close_pl_per_spread_$ – estimated P/L per spread in dollars if short expires ITM and you close both
- itm_close_roi_pct_on_net – that ITM P/L as a % of your net debit

Ranking
- metric2_premium_over_leap_price_pct – Monthly premium as % of LEAPS price

---

## How to read the table

- Start with metric2_premium_over_leap_price_pct: higher = more monthly income per $ spent on the LEAPS.
- Check the LEAPS quality: leap_delta near your target; leap_intrinsic_pct_of_price higher = less decay risk.
- Check the short’s risk: cushion_to_short_strike_pct higher = more room before trouble.
- Sanity‑check worst‑case: itm_close_pl_per_spread_$ and itm_close_roi_pct_on_net tell you what happens if you must close both with the short ITM.

---


# PMCC Trading Tips & Strategy Notes

These notes provide practical guidance when using the PMCC (Poor Man's Covered Call) screener.

## 1. Always Aim to Stay in Profit
- Structure the position so that even if the short call expires **in-the-money**, you can roll it or close early for a net gain.
- Avoid LEAPS with very low intrinsic value relative to their price — you want a solid "equity-like" position.
- Choose short calls that bring enough premium to lower your cost basis quickly.

## 2. Rolling the Short Call
- **Rolling** = closing the existing short call and opening another one (later expiry, different strike) before expiry.
- Rolling up and out can:
  - Capture more premium
  - Increase strike for more upside potential
  - Avoid assignment risk if the short call goes deep ITM
- Monitor theta decay and IV — roll when most of the premium is gone or when short delta gets too high (> 0.7).

## 3. Using Greeks
- **Delta**:
  - LEAPS: Target 0.75–0.85 for equity-like behavior.
  - Short call: 0.15–0.4 for decent premium without excessive ITM risk.
- **Theta**:
  - The short call should have positive theta for you (you benefit from time decay).
- **IV (Implied Volatility)**:
  - High IV = more premium but also more risk of sharp moves.
  - Use IV Rank to time entries — higher IV makes short calls more attractive.

## 4. Growth Stocks Considerations
- PMCC works best on **growth or trending stocks** because:
  - LEAPS gain from upward movement (delta exposure)
  - Short calls bring in regular income
- Avoid very low liquidity stocks — ensure both LEAPS and short calls have good open interest and tight bid/ask spreads.

## 5. Position Sizing
- Start small, scale in only if the trade behaves as expected.
- Don't allocate more than a set % of your portfolio to a single ticker PMCC.

## 6. Early Close Buffer
- The `early_close_buffer` in the script accounts for closing ITM short calls slightly before expiry to avoid assignment.
- This simulates paying a small amount ($0.30 default) extra per share when closing early.

## 7. General Best Practices
- Keep an eye on earnings dates — avoid holding short calls through earnings unless IV crush is the main play.
- Roll or close positions before big events if you want to limit gap risk.
- Review your positions weekly — adjust short legs if delta drifts too high.


## Disclaimer

This tool is for research/education. Option strategies carry risk. Verify quotes/Greeks and confirm execution costs/slippage on your broker before trading.
