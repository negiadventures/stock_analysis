import React, { useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  Tooltip,
  Title,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
} from "chart.js";

ChartJS.register(
  Tooltip,
  Title,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale
);
const aggregateData = (data, interval) => {
  const intervals = {
    "1m": 1 * 60 * 1000,
    "5m": 5 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
  };

  const aggregatedData = [];
  let startTime = data[0].x;

  let sumY = 0;
  let count = 0;

  for (const point of data) {
    if (point.x - startTime < intervals[interval]) {
      sumY += point.y;
      count++;
    } else {
      aggregatedData.push({
        x: new Date(startTime).toLocaleString(),
        y: sumY / count,
      });
      startTime = point.x;
      sumY = point.y;
      count = 1;
    }
  }

  if (count > 0) {
    aggregatedData.push({
      x: new Date(startTime).toLocaleString(),
      y: sumY / count,
    });
  }

  return aggregatedData;
};

function Chart({ symbol, chartData }) {
  const [interval, setInterval] = useState("1m"); // Default interval is 1 minute
  const handleIntervalChange = (newInterval) => {
    setInterval(newInterval);
  };
  const data = {
    labels: aggregateData(chartData, interval).map((point) => point.x),
    datasets: [
      {
        label: `${symbol} Price`,
        data: aggregateData(chartData, interval).map((point) => point.y),
        fill: false,
        borderColor: "#0073e6",
        backgroundColor: "#0073e6",
        tension: 0.1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: function (tooltipItem) {
            return `Price: $${tooltipItem.raw}`;
          },
        },
      },
    },
    scales: {
      x: { display: false },
      y: { title: { display: true, text: "Price ($)" } },
    },
  };

  return (
    <div>
      <h4 className="chart-title">{symbol}</h4>
      <div className="chart-interval-buttons">
        {["1m", "5m", "30m", "1h"].map((time) => (
          <button
            key={time}
            onClick={() => handleIntervalChange(time)}
            className={interval === time ? "active" : ""}
          >
            {time}
          </button>
        ))}
      </div>
      <div className="chart-wrapper">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}

export default Chart;
