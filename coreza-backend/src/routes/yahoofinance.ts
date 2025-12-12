/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import express from "express";
import { DataService } from "../services/data";
import { requireAuth } from "../middleware/jwtAuth";

const router = express.Router();

// Apply JWT authentication to all routes
router.use(requireAuth);

// Get candle/historical data
router.post("/get-candle", async (req, res, next) => {
  try {
    const {
      symbol,
      interval = "1d",
      lookback = 100,
      date_mode = "lookback",
      start_date,
      end_date,
    } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "ticker is required" });
    }

    let start: Date;
    let end: Date;

    /* ---------------- DATE RESOLUTION ---------------- */
    if (date_mode === "range") {
      // start_date is mandatory in range mode
      if (!start_date) {
        return res.status(400).json({
          error: "start_date is required for range mode",
        });
      }

      start = new Date(start_date);
      end = end_date ? new Date(end_date) : new Date(); // ← till latest

      // Validation
      if (isNaN(start.getTime())) {
        return res.status(400).json({
          error: `Invalid start_date: ${start_date}`,
        });
      }

      if (isNaN(end.getTime())) {
        return res.status(400).json({
          error: `Invalid end_date: ${end_date}`,
        });
      }

      if (start >= end) {
        return res.status(400).json({
          error: "start_date must be before end_date",
        });
      }
    } else {
      /* ---------------- LOOKBACK MODE ---------------- */
      end = new Date();
      start = new Date();

      const lookbackNum = Number(lookback) || 100;

      switch (interval) {
        case "1m":
          start.setMinutes(end.getMinutes() - lookbackNum);
          break;
        case "5m":
          start.setMinutes(end.getMinutes() - lookbackNum * 5);
          break;
        case "15m":
          start.setMinutes(end.getMinutes() - lookbackNum * 15);
          break;
        case "60m":
          start.setHours(end.getHours() - lookbackNum);
          break;
        case "1d":
        default:
          start.setDate(end.getDate() - lookbackNum);
          break;
      }
    }

    console.log(
      `[YahooFinance] Fetching ${symbol} from ${start.toISOString()} to ${end.toISOString()} interval=${interval}`
    );

    const result = await DataService.execute("yahoofinance", "get_history", {
      symbol,
      period1: start.toISOString(),
      period2: end.toISOString(),
      interval,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
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
