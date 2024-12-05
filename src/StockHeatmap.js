import React, { useRef, useEffect, useState } from "react";
import axios from "axios";
import "./StockHeatmap.css";
import Chart from "./Chart"; // Ensure you have this component and import it

const BUCKETS = [
  { label: "1-20", min: 1, max: 20 },
  { label: "10- 50", min: 20, max: 50 },
  { label: "50 - 100", min: 50, max: 100 },
  { label: "100 - 150", min: 100, max: 150 },
  { label: "150 - 200", min: 150, max: 200 },
  { label: "200 - 250", min: 200, max: 250 },
  { label: "250 - 300", min: 250, max: 300 },
  { label: "300+", min: 300, max: Infinity },
];

function StockHeatmap() {
  const [stocks, setStocks] = useState([]);
  const [selectedBucket, setSelectedBucket] = useState(BUCKETS[0]);
  const [viewMode, setViewMode] = useState("blocks"); // "blocks", "table", or "optionChain"
  const [selectedExchange, setSelectedExchange] = useState("NASDAQ");
  const [optionChainData, setOptionChainData] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [lastsale, setLastSale] = useState(null);
  const [pctchange, setPctChange] = useState(null);
  const [searchTerm, setSearchTerm] = useState(""); // New search term state
  const [selectedSymbols, setSelectedSymbols] = useState([]); // New state for selected symbols
  const [chartData, setChartData] = useState([]); // New state to store chart data
  const [optionData, setOptionData] = useState({});

  useEffect(() => {
    const fetchStocks = async () => {
      try {
        const response = await axios.get(
          `/api/screener/stocks?tableonly=false&limit=4000&exchange=${selectedExchange}`
        );
        const stockData = response.data.data.table.rows
          .map((stock) => ({
            ...stock,
            lastsale: parseFloat(stock.lastsale.replace("$", "")),
            marketCap: parseFloat(stock.marketCap.replace(/,/g, "")),
            pctchange: parseFloat(stock.pctchange.replace("%", "")),
            netchange: parseFloat(stock.netchange),
          }))
          .filter(
            (stock) =>
              /* TODO: CRITERIA 
                1. price $1-$20
                2. daily change (> 10%)
                3. volume > avg volume (> 2x)
                4. volume is high (maybe > 1 million)
                5. float(total shares) is high > 1 million maybe?
                */
              (stock.lastsale >= 1 &&
                stock.lastsale < 10 &&
                stock.pctchange > 10) ||
              (stock.lastsale >= 20 && stock.marketCap >= 1_000_000)
          )
          .filter((stock) => stock.pctchange)
          .sort((a, b) => b.pctchange - a.pctchange); // Sort by highest pctchange first

        setStocks(stockData);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchStocks();
    const interval = setInterval(fetchStocks, 5000);
    return () => clearInterval(interval);
  }, [selectedExchange]);
  const handleCheckboxChange = (symbol) => {
    setSelectedSymbols((prevSelected) =>
      prevSelected.includes(symbol)
        ? prevSelected.filter((s) => s !== symbol)
        : [...prevSelected, symbol]
    );
  };

  const fetchChartData = async () => {
    try {
      const chartResponses = await Promise.all(
        selectedSymbols.map((symbol) =>
          axios.get(`/api/quote/${symbol}/chart?assetclass=stocks`)
        )
      );

      const charts = chartResponses.map((response, index) => ({
        symbol: selectedSymbols[index],
        data: response.data.data.chart,
      }));
      setChartData(charts);
      setViewMode("chartGrid");
    } catch (error) {
      console.error("Error fetching chart data:", error);
    }
  };

  useEffect(() => {
    if (viewMode === "chartGrid") {
      fetchChartData(); // Initial fetch
      const intervalId = setInterval(fetchChartData, 5000); // Fetch every 5 seconds

      return () => clearInterval(intervalId); // Clear interval on unmount
    }
  }, [viewMode, selectedSymbols]); // Re-run when selectedSymbols change

  const fetchOptionChain = async (symbol, lastsale, pctchange) => {
    try {
      const response = await axios.get(
        `/api/quote/${symbol}/option-chain?assetclass=stocks&limit=60`
      );
      setOptionChainData(response?.data?.data?.table?.rows ?? []);
      setSelectedSymbol(symbol);
      setLastSale(lastsale);
      setPctChange(pctchange);
      setViewMode("optionChain");
    } catch (error) {
      console.error("Error fetching option chain data:", error);
    }
  };

  // Filter stocks based on search term and selected bucket
  const filteredStocks = stocks.filter((stock) => {
    return (
      stock.lastsale >= selectedBucket.min &&
      stock.lastsale < selectedBucket.max &&
      (stock.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        stock.name.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  });

  const onViewIncomeCalculator = (row) => {
    setOptionData(row);
    setViewMode("incomeCalculator");
  };

  const handleSearch = (e) => {
    const term = e.target.value;
    setSearchTerm(term);

    // Automatically set the correct bucket if search matches only one stock with a specific last sale range
    const matchedStock = stocks.find(
      (stock) =>
        stock.symbol.toLowerCase().includes(term.toLowerCase()) ||
        stock.name.toLowerCase().includes(term.toLowerCase())
    );

    if (matchedStock) {
      const matchingBucket = BUCKETS.find(
        (bucket) =>
          matchedStock.lastsale >= bucket.min &&
          matchedStock.lastsale < bucket.max
      );
      if (matchingBucket) setSelectedBucket(matchingBucket);
    }
  };

  return (
    <div className="heatmap-container">
      {viewMode === "optionChain" ? (
        <OptionChainTable
          symbol={selectedSymbol}
          optionChainData={optionChainData}
          onBack={(targetView) => setViewMode(targetView ?? "table")}
          lastsale={lastsale}
          pctchange={pctchange}
          onViewIncomeCalculator={onViewIncomeCalculator}
        />
      ) : viewMode === "incomeCalculator" ? (
        <OptionIncomeCalculator
          symbol={selectedSymbol}
          optionData={optionData}
          onBack={(targetView) => setViewMode(targetView ?? "table")}
          lastsale={lastsale}
          pctchange={pctchange}
        />
      ) : viewMode === "chartGrid" ? (
        <div className="chart-grid">
          <button onClick={() => setViewMode("table")} className="back-button">
            Back to Table
          </button>
          <h1 className="chart-grid-heading">Stock Charts</h1>
          <div className="chart-grid-container">
            {chartData.map((chart) => (
              <div key={chart.symbol} className="chart-container">
                <Chart symbol={chart.symbol} chartData={chart.data} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <h1>Stock Analyzer</h1>

          <div className="view-mode-toggle">
            <label>View Mode:</label>
            <button
              onClick={() => setViewMode("blocks")}
              disabled={viewMode === "blocks"}
            >
              Heatmap
            </button>
            <button
              onClick={() => setViewMode("table")}
              disabled={viewMode === "table"}
            >
              Table
            </button>

            <button
              onClick={() => setViewMode("compound_calc")}
              disabled={viewMode === "compound_calc"}
            >
              Premium Calculator
            </button>
          </div>
          {viewMode !== "compound_calc" ? (
            <div className="exchange-filter">
              <label>Exchange:</label>
              <select
                value={selectedExchange}
                onChange={(e) => setSelectedExchange(e.target.value)}
              >
                <option value="NASDAQ">NASDAQ</option>
                <option value="NYSE">NYSE</option>
                <option value="AMEX">AMEX</option>
              </select>
            </div>
          ) : (
            ""
          )}
          {viewMode !== "compound_calc" ? (
            <div className="tabs">
              <label>Last Price Filter:</label>
              {BUCKETS.map((bucket) => (
                <button
                  key={bucket.label}
                  className={`tab ${
                    bucket.label === selectedBucket.label ? "active" : ""
                  }`}
                  onClick={() => setSelectedBucket(bucket)}
                >
                  {bucket.label}
                </button>
              ))}
            </div>
          ) : (
            ""
          )}
          {/* Search Bar */}
          {viewMode !== "compound_calc" ? (
            <div className="search-bar">
              <label htmlFor="stock-search">Search Stocks:</label>
              <input
                type="text"
                id="stock-search"
                placeholder="Enter symbol or name"
                value={searchTerm}
                onChange={handleSearch}
              />
            </div>
          ) : (
            ""
          )}
          {viewMode !== "compound_calc" ? (
            <h1>{selectedExchange} Stocks</h1>
          ) : (
            ""
          )}

          {viewMode === "blocks" ? (
            <div className="heatmap">
              {filteredStocks.map((stock) => (
                <StockBlock key={stock.symbol} stock={stock} />
              ))}
            </div>
          ) : viewMode === "compound_calc" ? (
            <CompoundCalc />
          ) : (
            <>
              <StockTable
                stocks={filteredStocks}
                onViewOptionChain={fetchOptionChain}
                onCheckboxChange={handleCheckboxChange}
                selectedSymbols={selectedSymbols} // Ensure this is passed correctly
                onFetchChartData={fetchChartData} // Pass the chart data fetching function
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function StockBlock({ stock }) {
  const { symbol, lastsale, pctchange, netchange, marketCap, url } = stock;
  const blockRef = useRef(null);
  const [fontSize, setFontSize] = useState(16);

  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        const newFontSize = Math.min(width, height) * 0.15;
        setFontSize(newFontSize);
      }
    });

    if (blockRef.current) {
      resizeObserver.observe(blockRef.current);
    }

    return () => {
      if (blockRef.current) {
        resizeObserver.unobserve(blockRef.current);
      }
    };
  }, []);

  const isPositive = pctchange >= 0;
  const colorIntensity = Math.min(Math.abs(pctchange * 10), 100);
  const bgColor = isPositive
    ? `rgba(0, 255, 0, ${colorIntensity / 100})`
    : `rgba(255, 0, 0, ${colorIntensity / 100})`;

  const handleClick = () => {
    window.open(`https://nasdaq.com${url}`, "_blank");
  };

  return (
    <div
      className="stock-block"
      ref={blockRef}
      style={{ fontSize: `${fontSize}px`, backgroundColor: bgColor }}
      onClick={handleClick}
    >
      <div className="symbol" style={{ fontSize: `${fontSize * 1.2}px` }}>
        {symbol}
      </div>
      <div className="details" style={{ fontSize: `${fontSize * 0.8}px` }}>
        <div>Last Sale: ${lastsale}</div>
        <div>Change: {pctchange}%</div>
        <div>Net: {netchange}</div>
        <div>Market Cap: {formatMarketCap(marketCap)}</div>
      </div>
    </div>
  );
}
function CompoundCalc() {
  const [initialInvestment, setInitialInvestment] = useState(9000);
  const [strikePrice, setStrikePrice] = useState(22);
  const [premiumPerContract, setPremiumPerContract] = useState(6);
  const [contractPeriod, setContractPeriod] = useState(22);
  const [investmentPeriod, setInvestmentPeriod] = useState(365);
  const [investmentData, setInvestmentData] = useState([]);

  useEffect(() => {
    calculateInvestmentData();
  }, [
    initialInvestment,
    strikePrice,
    premiumPerContract,
    contractPeriod,
    investmentPeriod,
  ]);

  const calculateInvestmentData = () => {
    const data = [];
    let day = 1;
    let currentInvestment = initialInvestment;
    let previousFinalBalance = 0; // Track the Final Balance of the previous row, initially 0 for the first row
    while (day <= investmentPeriod) {
      // Calculate the investment details for the current row
      let investmentAmount =
        currentInvestment - (currentInvestment % (strikePrice * 100));
      let numberOfContracts = Math.floor(
        investmentAmount / (strikePrice * 100)
      );
      let remainingBalance = currentInvestment % (strikePrice * 100);
      let premiumProfit = premiumPerContract * 100 * numberOfContracts;
      let finalBalance = investmentAmount + premiumProfit + remainingBalance;
      let reInvestAmount = remainingBalance + premiumProfit;
      // Calculate reInvestAmount based on the given formula
      //   if (data.length > 0) {
      //     finalBalance += previousFinalBalance - investmentAmount;
      //   }
      // Push the main row for this investment day
      data.push({
        day,
        currentInvestment,
        investmentAmount,
        numberOfContracts,
        remainingBalance,
        premiumProfit,
        finalBalance,
        reInvestAmount,
      });

      // Update previousFinalBalance for the next iteration
      previousFinalBalance = finalBalance;
      // Group additional rows if reInvestAmount is a multiple of (strikePrice * 100)
      while (reInvestAmount && reInvestAmount / (strikePrice * 100) >= 1) {
        // Recalculate the values based on reInvestAmount for additional grouped rows
        currentInvestment = reInvestAmount;
        investmentAmount =
          currentInvestment - (currentInvestment % (strikePrice * 100));
        numberOfContracts = Math.floor(investmentAmount / (strikePrice * 100));
        remainingBalance = currentInvestment % (strikePrice * 100);
        premiumProfit = premiumPerContract * 100 * numberOfContracts;
        finalBalance = premiumProfit + previousFinalBalance;

        // Calculate reInvestAmount again for the grouped row using the same formula
        reInvestAmount = premiumProfit + remainingBalance;

        // Push the additional row without incrementing the day
        data.push({
          day: "", // Empty day field for grouped rows
          currentInvestment,
          investmentAmount,
          numberOfContracts,
          remainingBalance,
          premiumProfit,
          finalBalance,
          reInvestAmount,
        });

        // Update previousFinalBalance to reflect the new final balance
        previousFinalBalance = finalBalance;
        // Break if reInvestAmount is no longer a multiple of (strikePrice * 100)
        // if (reInvestAmount && reInvestAmount % (strikePrice * 100) < 1) {
        //   break;
        // }
      }

      // Move to the next investment day and update the current investment
      currentInvestment = finalBalance;
      day += contractPeriod;
    }

    setInvestmentData(data);
  };

  // Calculate Total Profit and Profit %
  const finalRow = investmentData[investmentData.length - 1] || {};
  const totalProfit = (finalRow.finalBalance || 0) - initialInvestment;
  const profitPercent = (totalProfit / initialInvestment) * 100;

  return (
    <div className="compound-calc-container">
      <h3>Premium Calculator</h3>
      <div className="input-fields">
        <label>
          Initial Investment:
          <input
            type="number"
            value={initialInvestment}
            onChange={(e) => setInitialInvestment(Number(e.target.value))}
          />
        </label>
        <label>
          Strike Price:
          <input
            type="number"
            value={strikePrice}
            onChange={(e) => setStrikePrice(Number(e.target.value))}
          />
        </label>
        <label>
          Premium per Contract:
          <input
            type="number"
            value={premiumPerContract}
            onChange={(e) => setPremiumPerContract(Number(e.target.value))}
          />
        </label>
        <label>
          Contract Period (days):
          <input
            type="number"
            value={contractPeriod}
            onChange={(e) => setContractPeriod(Number(e.target.value))}
          />
        </label>
        <label>
          Investment Period (days):
          <input
            type="number"
            value={investmentPeriod}
            onChange={(e) => setInvestmentPeriod(Number(e.target.value))}
          />
        </label>
      </div>

      {/* Table 1: Summary */}
      <table className="summary-table">
        <thead>
          <tr>
            <th>Total Profit ($)</th>
            <th>Profit (%)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{totalProfit.toFixed(2)}</td>
            <td>{profitPercent.toFixed(2)}%</td>
          </tr>
        </tbody>
      </table>

      {/* Table 2: Investment Data */}
      <table className="investment-table">
        <thead>
          <tr>
            <th>Investment Day</th>
            <th>Bank Balance</th>
            <th>Amount to be Utilized</th>
            <th>Number of Contracts</th>
            <th>Remaining Balance</th>
            <th>Premium Profit</th>
            <th>Re-invest Amount (Remaining + Profit)</th>
            <th>Final Balance</th>
          </tr>
        </thead>
        <tbody>
          {investmentData.map((row, index) => (
            <tr key={index}>
              <td>{row.day}</td>
              <td>{row.currentInvestment.toFixed(2)}</td>
              <td>{row.investmentAmount.toFixed(2)}</td>
              <td>{row.numberOfContracts}</td>
              <td>{row.remainingBalance.toFixed(2)}</td>
              <td>{row.premiumProfit.toFixed(2)}</td>
              <td>{row.reInvestAmount.toFixed(2)}</td>
              <td>{row.finalBalance.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OptionChainTable({
  symbol,
  lastsale,
  pctchange,
  onBack,
  onViewIncomeCalculator,
}) {
  const [optionChainData, setOptionChainData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const fetchOptionChain = async () => {
      try {
        const response = await axios.get(
          `/api/quote/${symbol}/option-chain?assetclass=stocks&limit=100`
        );

        const { data } = response.data;

        // Check if table data exists and has rows
        if (
          data &&
          data.table &&
          data.table.rows &&
          data.table.rows.length > 0
        ) {
          setOptionChainData(data.table.rows);
          setErrorMessage(""); // Clear any previous error messages
        } else {
          // Set error message and clear option data
          setOptionChainData([]);
          setErrorMessage(`Options not available for ${symbol}`);
        }
      } catch (error) {
        console.error("Error fetching option chain data:", error);
        setOptionChainData([]);
        setErrorMessage(`Options not available for ${symbol}`);
      }
    };

    // Initial fetch on component mount
    fetchOptionChain();

    // Set interval for fetching every 10 seconds
    const interval = setInterval(fetchOptionChain, 5000);

    // Clear interval on component unmount
    return () => clearInterval(interval);
  }, [symbol, lastsale, pctchange]);

  return (
    <div className="option-chain-container">
      <button onClick={onBack} className="back-button">
        Back to Table
      </button>
      {errorMessage ? (
        <p className="error-message">{errorMessage}</p>
      ) : (
        optionChainData && (
          <>
            <h3 className="option-chain-heading">
              Option Chain for {symbol} - ${lastsale}({pctchange}%)
            </h3>
            <table className="option-chain-table">
              <thead>
                <tr>
                  <th>Exp. Date</th>
                  <th>Call Last</th>
                  <th>Call Change</th>
                  <th>Call Bid</th>
                  <th>Call Ask</th>
                  <th>Call Volume</th>
                  <th>Call Open Int.</th>
                  <th>Strike</th>
                  <th>Put Last</th>
                  <th>Put Change</th>
                  <th>Put Bid</th>
                  <th>Put Ask</th>
                  <th>Put Volume</th>
                  <th>Put Open Int.</th>
                  <th>Income Calculator</th>
                </tr>
              </thead>
              <tbody>
                {optionChainData
                  //   .filter((row) => row.c_Last)
                  .map((row, index) => (
                    <tr key={index}>
                      <td>{row.expiryDate || row.expirygroup}</td>
                      <td
                        style={{
                          backgroundColor: getBgColor(row.c_Last, row.c_Change),
                        }}
                      >
                        {row.c_Last}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(
                            row.c_Change,
                            row.c_Change
                          ),
                        }}
                      >
                        {row.c_Change}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(row.c_Bid, row.c_Change),
                        }}
                      >
                        {row.c_Bid}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(row.c_Ask, row.c_Change),
                        }}
                      >
                        {row.c_Ask}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(
                            row.c_Volume,
                            row.c_Change
                          ),
                        }}
                      >
                        {row.c_Volume}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(
                            row.c_Openinterest,
                            row.c_Change
                          ),
                        }}
                      >
                        {row.c_Openinterest}
                      </td>
                      <td>{row.strike}</td>
                      <td
                        style={{
                          backgroundColor: getBgColor(row.p_Last, row.p_Change),
                        }}
                      >
                        {row.p_Last}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(
                            row.p_Change,
                            row.p_Change
                          ),
                        }}
                      >
                        {row.p_Change}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(row.p_Bid, row.p_Change),
                        }}
                      >
                        {row.p_Bid}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(row.p_Ask, row.p_Change),
                        }}
                      >
                        {row.p_Ask}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(
                            row.p_Volume,
                            row.p_Change
                          ),
                        }}
                      >
                        {row.p_Volume}
                      </td>
                      <td
                        style={{
                          backgroundColor: getBgColor(
                            row.p_Openinterest,
                            row.p_Change
                          ),
                        }}
                      >
                        {row.p_Openinterest}
                      </td>
                      <td>
                        {row.c_Last && (
                          <button onClick={() => onViewIncomeCalculator(row)}>
                            Calculate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        )
      )}
    </div>
  );
}

function OptionIncomeCalculator({
  symbol,
  optionData,
  lastsale,
  pctchange,
  onBack,
}) {
  // Separate state variables for Put and Call calculators
  const [putTotalInvestment, setPutTotalInvestment] = useState(10000);
  const [putPeriod, setPutPeriod] = useState(30);
  const [callTotalInvestment, setCallTotalInvestment] = useState(10000);
  const [callPeriod, setCallPeriod] = useState(30);

  // Calculation function that uses independent inputs for each option type
  const calculateTableData = (totalInvestment, period, profitPerContract) => {
    const perContractPrice = optionData.strike * 100;
    const initialContractsAssigned = Math.floor(
      totalInvestment / perContractPrice
    );
    const totalInitialInvestmentUtilized =
      perContractPrice * initialContractsAssigned;
    const totalInitialProfit = initialContractsAssigned * profitPerContract;

    // Initialize table data with the first row based on independent inputs
    let tableData = [
      {
        investment: totalInitialInvestmentUtilized,
        contracts: initialContractsAssigned,
        profit: totalInitialProfit,
        totalBalance: totalInitialInvestmentUtilized + totalInitialProfit,
        day: period,
      },
    ];

    // Calculate subsequent rows based on previous row values
    for (let i = 1; i <= 5; i++) {
      const prevRow = tableData[i - 1];
      const investment =
        prevRow.totalBalance - (prevRow.totalBalance % perContractPrice);
      const contracts = Math.floor(investment / perContractPrice);
      const profit = contracts * profitPerContract;
      const totalBalance = prevRow.totalBalance + profit;
      const day = (i + 1) * period;

      tableData.push({ investment, contracts, profit, totalBalance, day });
    }

    return {
      initialData: {
        perContractPrice,
        initialContractsAssigned,
        totalInitialInvestmentUtilized,
        totalInitialProfit,
      },
      tableData,
    };
  };

  const putData = calculateTableData(
    putTotalInvestment,
    putPeriod,
    optionData.p_Last * 100
  );
  const callData = calculateTableData(
    callTotalInvestment,
    callPeriod,
    optionData.c_Last * 100
  );
  // Calculations for Table 5 and Table 6
  const calculateSummary = (initialInvestment, finalRow) => {
    const finalValue = finalRow.totalBalance;
    const period = finalRow.day;
    const totalProfitDollar = finalValue - initialInvestment;
    const totalProfitPercent = (totalProfitDollar / initialInvestment) * 100;

    return {
      initialInvestment,
      finalValue,
      period,
      totalProfitDollar,
      totalProfitPercent,
    };
  };

  const putSummary = calculateSummary(
    putData.initialData.totalInitialInvestmentUtilized,
    putData.tableData[putData.tableData.length - 1]
  );
  const callSummary = calculateSummary(
    callData.initialData.totalInitialInvestmentUtilized,
    callData.tableData[callData.tableData.length - 1]
  );

  return (
    <div className="option-income-calculator-container">
      <button onClick={() => onBack("optionChain")} className="back-button">
        Back to Option Chain
      </button>

      {/* Put Option Income Calculator */}
      <div className="option-calculator-section">
        <h3>
          {symbol} ({lastsale}) - PUT OPTION INCOME CALCULATOR
        </h3>
        <div className="calculator-tables">
          {/* Table 1 - Columnar */}
          <table className="income-table columnar">
            <tbody>
              <tr>
                <td>Total Investment</td>
                <td>
                  <input
                    type="text"
                    value={putTotalInvestment}
                    onChange={(e) =>
                      setPutTotalInvestment(Number(e.target.value))
                    }
                  />
                </td>
              </tr>
              <tr>
                <td>Period (days)</td>
                <td>
                  <input
                    type="text"
                    value={putPeriod}
                    onChange={(e) => setPutPeriod(Number(e.target.value))}
                  />
                </td>
              </tr>
              <tr>
                <td>Strike Price</td>
                <td>{optionData.strike}</td>
              </tr>
              <tr>
                <td>Per Contract Price</td>
                <td>{putData.initialData.perContractPrice}</td>
              </tr>
              <tr>
                <td>Initial Contracts Assigned</td>
                <td>{putData.initialData.initialContractsAssigned}</td>
              </tr>
              <tr>
                <td>Profit Per Contract</td>
                <td>{optionData.p_Last * 100}</td>
              </tr>
              <tr>
                <td>Total Initial Investment Utilized</td>
                <td>{putData.initialData.totalInitialInvestmentUtilized}</td>
              </tr>
              <tr>
                <td>Total Initial Profit</td>
                <td>{putData.initialData.totalInitialProfit}</td>
              </tr>
            </tbody>
          </table>

          {/* Table 2 */}
          <table className="income-table">
            <thead>
              <tr>
                <th>Investment</th>
                <th>Contracts</th>
                <th>Profit</th>
                <th>Total Balance</th>
                <th>Day</th>
              </tr>
            </thead>
            <tbody>
              {putData.tableData.map((row, index) => (
                <tr key={index}>
                  <td>{row.investment.toFixed(2)}</td>
                  <td>{row.contracts}</td>
                  <td>{row.profit.toFixed(2)}</td>
                  <td>{row.totalBalance.toFixed(2)}</td>
                  <td>{row.day}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Table 5 - Summary for Put Option */}
        <table className="income-table summary-table full-width">
          <thead>
            <tr>
              <th>Initial Investment</th>
              <th>Final Value</th>
              <th>Period</th>
              <th>Total Profit ($)</th>
              <th>Total Profit (%)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{putSummary.initialInvestment.toFixed(2)}</td>
              <td>{putSummary.finalValue.toFixed(2)}</td>
              <td>{putSummary.period}</td>
              <td>{putSummary.totalProfitDollar.toFixed(2)}</td>
              <td>{putSummary.totalProfitPercent.toFixed(2)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Call Option Income Calculator */}
      <div className="option-calculator-section">
        <h3>
          {symbol} ({lastsale}) - CALL OPTION INCOME CALCULATOR
        </h3>
        <div className="calculator-tables">
          {/* Table 3 - Columnar */}
          <table className="income-table columnar">
            <tbody>
              <tr>
                <td>Total Investment</td>
                <td>
                  <input
                    type="text"
                    value={callTotalInvestment}
                    onChange={(e) =>
                      setCallTotalInvestment(Number(e.target.value))
                    }
                  />
                </td>
              </tr>
              <tr>
                <td>Period (days)</td>
                <td>
                  <input
                    type="text"
                    value={callPeriod}
                    onChange={(e) => setCallPeriod(Number(e.target.value))}
                  />
                </td>
              </tr>
              <tr>
                <td>Strike Price</td>
                <td>{optionData.strike}</td>
              </tr>
              <tr>
                <td>Per Contract Price</td>
                <td>{callData.initialData.perContractPrice}</td>
              </tr>
              <tr>
                <td>Initial Contracts Assigned</td>
                <td>{callData.initialData.initialContractsAssigned}</td>
              </tr>
              <tr>
                <td>Profit Per Contract</td>
                <td>{optionData.c_Last * 100}</td>
              </tr>
              <tr>
                <td>Total Initial Investment Utilized</td>
                <td>{callData.initialData.totalInitialInvestmentUtilized}</td>
              </tr>
              <tr>
                <td>Total Initial Profit</td>
                <td>{callData.initialData.totalInitialProfit}</td>
              </tr>
            </tbody>
          </table>

          {/* Table 4 */}
          <table className="income-table">
            <thead>
              <tr>
                <th>Investment</th>
                <th>Contracts</th>
                <th>Profit</th>
                <th>Total Balance</th>
                <th>Day</th>
              </tr>
            </thead>
            <tbody>
              {callData.tableData.map((row, index) => (
                <tr key={index}>
                  <td>{row.investment.toFixed(2)}</td>
                  <td>{row.contracts}</td>
                  <td>{row.profit.toFixed(2)}</td>
                  <td>{row.totalBalance.toFixed(2)}</td>
                  <td>{row.day}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Table 6 - Summary for Call Option */}
        <table className="income-table summary-table full-width">
          <thead>
            <tr>
              <th>Initial Investment</th>
              <th>Final Value</th>
              <th>Period</th>
              <th>Total Profit ($)</th>
              <th>Total Profit (%)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{callSummary.initialInvestment.toFixed(2)}</td>
              <td>{callSummary.finalValue.toFixed(2)}</td>
              <td>{callSummary.period}</td>
              <td>{callSummary.totalProfitDollar.toFixed(2)}</td>
              <td>{callSummary.totalProfitPercent.toFixed(2)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getBgColor(value, change) {
  if (!change) return "white"; // No change, keep background white
  const isPositive = parseFloat(change) >= 0;
  const colorIntensity = Math.min(Math.abs(parseFloat(change) * 10), 100);
  return isPositive
    ? `rgba(0, 255, 0, ${colorIntensity / 100})`
    : `rgba(255, 0, 0, ${colorIntensity / 100})`;
}
function StockTable({
  stocks,
  onViewOptionChain,
  onCheckboxChange,
  selectedSymbols,
  onFetchChartData,
}) {
  const [sortConfig, setSortConfig] = useState({
    key: "pctchange",
    direction: "desc",
  });

  const sortedStocks = [...stocks].sort((a, b) => {
    if (sortConfig.key) {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue < bValue) {
        return sortConfig.direction === "asc" ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === "asc" ? 1 : -1;
      }
      return 0;
    }
    return 0;
  });

  const handleSort = (key) => {
    let direction = "asc";

    if (sortConfig.key === key) {
      // Toggle direction if same column is clicked
      if (sortConfig.direction === "asc") {
        direction = "desc";
      } else if (sortConfig.direction === "desc") {
        key = null; // Reset sort if toggled again
        direction = "desc"; // Default direction for resetting
      }
    }

    setSortConfig({ key, direction });
  };

  const getSortArrow = (key) => {
    if (sortConfig.key === key) {
      return sortConfig.direction === "asc" ? "↑" : "↓";
    }
    return "";
  };

  return (
    <table className="stock-table">
      <thead>
        <tr>
          <th>
            {" "}
            <button
              onClick={onFetchChartData}
              disabled={selectedSymbols.length === 0}
              className="view-chart-button"
            >
              View Chart
            </button>
          </th>
          <th onClick={() => handleSort("symbol")}>
            Symbol {getSortArrow("symbol")}
          </th>
          <th onClick={() => handleSort("lastsale")}>
            Last Sale {getSortArrow("lastsale")}
          </th>
          <th onClick={() => handleSort("pctchange")}>
            % Change {getSortArrow("pctchange")}
          </th>
          <th onClick={() => handleSort("netchange")}>
            Net Change {getSortArrow("netchange")}
          </th>
          <th onClick={() => handleSort("marketCap")}>
            Market Cap {getSortArrow("marketCap")}
          </th>
          <th>Option Chain</th>
        </tr>
      </thead>
      <tbody>
        {sortedStocks.map((stock) => {
          const isSelected = selectedSymbols.includes(stock.symbol);
          const isPositive = stock.pctchange >= 0;
          const colorIntensity = Math.min(Math.abs(stock.pctchange * 10), 100);
          const bgColor = isPositive
            ? `rgba(0, 255, 0, ${colorIntensity / 100})`
            : `rgba(255, 0, 0, ${colorIntensity / 100})`;

          return (
            <tr key={stock.symbol} style={{ backgroundColor: bgColor }}>
              <td>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onCheckboxChange(stock.symbol)}
                />
              </td>
              <td>{stock.symbol}</td>
              <td>${stock.lastsale.toFixed(2)}</td>
              <td>{stock.pctchange}%</td>
              <td>{stock.netchange}</td>
              <td>{formatMarketCap(stock.marketCap)}</td>
              <td>
                <button
                  onClick={() =>
                    onViewOptionChain(
                      stock.symbol,
                      stock.lastsale,
                      stock.pctchange
                    )
                  }
                >
                  View Option Chain
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function formatMarketCap(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return value.toString();
}

export default StockHeatmap;
