import express from "express";
import { DataService } from "../services/data";

const router = express.Router();

// Get candle/historical data
router.post("/get-candle", async (req, res, next) => {
  try {
    const { symbol, interval = "1d", lookback = 100 } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "ticker is required" });
    }

    // Calculate date range based on lookback
    const end = new Date();
    const start = new Date();

    // Calculate start date based on interval and lookback
    const lookbackNum = parseInt(lookback);
    switch (interval) {
      case "1m":
      case "5m":
      case "15m":
        start.setMinutes(end.getMinutes() - lookbackNum * parseInt(interval));
        break;
      case "60m":
        start.setHours(end.getHours() - lookbackNum);
        break;
      case "1d":
      default:
        start.setDate(end.getDate() - lookbackNum);
        break;
    }

    const result = await DataService.execute("yahoofinance", "get_history", {
      symbol: symbol,
      period1: start.toISOString(),
      period2: end.toISOString(),
      interval,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get quote data
router.get("/quote/:symbol", async (req, res, next) => {
  try {
    const { symbol } = req.params;

    const result = await DataService.execute("yahoofinance", "get_quote", {
      symbol,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get historical data
router.get("/history/:symbol", async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { period1, period2, interval = "1d" } = req.query;

    const result = await DataService.execute("yahoofinance", "get_history", {
      symbol,
      period1: period1 as string,
      period2: period2 as string,
      interval: interval as string,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Search symbols
router.get("/search/:query", async (req, res, next) => {
  try {
    const { query } = req.params;

    const result = await DataService.execute("yahoofinance", "search", {
      query,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get market summary
router.get("/summary", async (req, res, next) => {
  try {
    const result = await DataService.execute("yahoofinance", "get_summary", {});

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get trending symbols
router.get("/trending", async (req, res, next) => {
  try {
    const result = await DataService.execute(
      "yahoofinance",
      "get_trending",
      {}
    );

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;
