"""
Module: Indicator Service

Provides utilities to compute technical indicators (EMA, RSI, ADX)
from candle data for workflow endpoints.
"""

# Standard library imports
import json
from typing import Any, Dict, List, Optional

# Third-party imports
import numpy as np
import pandas as pd
import talib
from pydantic import BaseModel

def clean_json(obj: Any) -> Any:
    # … (unchanged) …
    if isinstance(obj, dict):
        return {k: clean_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_json(x) for x in obj]
    if isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    return obj

def to_dict_of_arrays(bars: List[Dict[str, Any]]) -> Dict[str, List[Any]]:
    # … (unchanged) …
    result: Dict[str, List[Any]] = {k: [] for k in ["t", "o", "h", "l", "c", "v"]}
    for bar in bars:
        t_val = bar.get("timestamp") or bar.get("t")
        if isinstance(t_val, str) and len(t_val) >= 10:
            t_val = t_val[:10]
        result["t"].append(t_val)
        result["o"].append(bar.get("open") or bar.get("o"))
        result["h"].append(bar.get("high") or bar.get("h"))
        result["l"].append(bar.get("low") or bar.get("l"))
        result["c"].append(bar.get("close") or bar.get("c"))
        result["v"].append(bar.get("volume") or bar.get("v"))
    return result

def ema_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    # … (unchanged) …
    window_raw = payload.get("window")
    raw_data = payload.get("candle_data")
    if window_raw is None or raw_data is None:
        return {"error": "window and candle_data are required"}
    try:
        window = int(window_raw)
        if window < 1:
            raise ValueError
    except Exception:
        return {"error": "window must be a positive integer"}

    if isinstance(raw_data, str):
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return {"error": "candle_data must be valid JSON string or array of objects"}
    else:
        parsed = raw_data

    if isinstance(parsed, dict):
        keys = ["t", "o", "h", "l", "c", "v"]
        if not all(k in parsed and isinstance(parsed[k], list) for k in keys):
            return {"error": "candle_data JSON must have keys t,o,h,l,c,v arrays"}
        parsed["t"] = [
            t[:10] if isinstance(t, str) and len(t) >= 10 else t
            for t in parsed["t"]
        ]
        df = pd.DataFrame({k: parsed[k] for k in keys})
        orig_candles = parsed
    elif isinstance(parsed, list):
        if not parsed:
            return {"error": "candle_data array cannot be empty"}
        records = []
        for bar in parsed:
            t_val = bar.get("timestamp") or bar.get("t")
            if isinstance(t_val, str) and len(t_val) >= 10:
                t_val = t_val[:10]
            records.append({
                "t": t_val,
                "o": bar.get("open") or bar.get("o"),
                "h": bar.get("high") or bar.get("h"),
                "l": bar.get("low") or bar.get("l"),
                "c": bar.get("close") or bar.get("c"),
                "v": bar.get("volume") or bar.get("v"),
            })
        df = pd.DataFrame(records)
        orig_candles = to_dict_of_arrays(records)
    else:
        return {"error": "Unsupported candle_data format"}

    if len(df) < window:
        return {"error": "Not enough candles for EMA calculation."}
    try:
        df["ema"] = talib.EMA(df["c"], timeperiod=window)
    except Exception as exc:
        return {"error": f"Error during EMA calculation: {exc}"}

    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    indicator = [{"t": row["t"], "value": row["ema"]} for _, row in df.iterrows()]
    output = {"indicator": indicator, "candles": orig_candles}
    return clean_json(output)

def rsi_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    # … (unchanged) …
    window_raw = payload.get("window")
    raw_data = payload.get("candle_data")
    if window_raw is None or raw_data is None:
        return {"error": "window and candle_data are required"}
    try:
        window = int(window_raw)
        if window < 1:
            raise ValueError
    except Exception:
        return {"error": "window must be a positive integer"}

    if isinstance(raw_data, str):
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return {"error": "candle_data must be valid JSON string or array of objects"}
    else:
        parsed = raw_data

    if isinstance(parsed, dict):
        keys = ["t", "o", "h", "l", "c", "v"]
        if not all(k in parsed and isinstance(parsed[k], list) for k in keys):
            return {"error": "candle_data JSON must have keys t,o,h,l,c,v arrays"}
        parsed["t"] = [
            t[:10] if isinstance(t, str) and len(t) >= 10 else t
            for t in parsed["t"]
        ]
        df = pd.DataFrame({k: parsed[k] for k in keys})
        orig_candles = parsed
    elif isinstance(parsed, list):
        if not parsed:
            return {"error": "candle_data array cannot be empty"}
        records = []
        for bar in parsed:
            t_val = bar.get("timestamp") or bar.get("t")
            if isinstance(t_val, str) and len(t_val) >= 10:
                t_val = t_val[:10]
            records.append({
                "t": t_val,
                "o": bar.get("open") or bar.get("o"),
                "h": bar.get("high") or bar.get("h"),
                "l": bar.get("low") or bar.get("l"),
                "c": bar.get("close") or bar.get("c"),
                "v": bar.get("volume") or bar.get("v"),
            })
        df = pd.DataFrame(records)
        orig_candles = to_dict_of_arrays(records)
    else:
        return {"error": "Unsupported candle_data format"}

    if len(df) < window:
        return {"error": "Not enough candles for RSI calculation."}
    try:
        df["rsi"] = talib.RSI(df["c"], timeperiod=window)
    except Exception as exc:
        return {"error": f"Error during RSI calculation: {exc}"}

    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    indicator = [{"t": row["t"], "value": row["rsi"]} for _, row in df.iterrows()]
    output = {"indicator": indicator, "candles": orig_candles}
    return clean_json(output)

def adx_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    # … (unchanged) …
    window_raw = payload.get("window")
    raw_data   = payload.get("candle_data")
    if window_raw is None or raw_data is None:
        return {"error": "window and candle_data are required"}
    try:
        window = int(window_raw)
        if window < 1:
            raise ValueError
    except Exception:
        return {"error": "window must be a positive integer"}

    if isinstance(raw_data, str):
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return {"error": "candle_data must be valid JSON string or array of objects"}
    else:
        parsed = raw_data

    if isinstance(parsed, dict):
        keys = ["t", "o", "h", "l", "c", "v"]
        if not all(k in parsed and isinstance(parsed[k], list) for k in keys):
            return {"error": "candle_data JSON must have keys t,o,h,l,c,v arrays"}
        parsed["t"] = [
            t[:10] if isinstance(t, str) and len(t) >= 10 else t
            for t in parsed["t"]
        ]
        df = pd.DataFrame({k: parsed[k] for k in keys})
        orig_candles = parsed
    elif isinstance(parsed, list):
        if not parsed:
            return {"error": "candle_data array cannot be empty"}
        records = []
        for bar in parsed:
            t_val = bar.get("timestamp") or bar.get("t")
            if isinstance(t_val, str) and len(t_val) >= 10:
                t_val = t_val[:10]
            records.append({
                "t": t_val,
                "o": bar.get("open")   or bar.get("o"),
                "h": bar.get("high")   or bar.get("h"),
                "l": bar.get("low")    or bar.get("l"),
                "c": bar.get("close")  or bar.get("c"),
                "v": bar.get("volume") or bar.get("v"),
            })
        df = pd.DataFrame(records)
        orig_candles = to_dict_of_arrays(records)
    else:
        return {"error": "Unsupported candle_data format"}

    if len(df) < window:
        return {"error": "Not enough candles for ADX calculation."}
    try:
        df["adx"] = talib.ADX(df["h"], df["l"], df["c"], timeperiod=window)
    except Exception as exc:
        return {"error": f"Error during ADX calculation: {exc}"}

    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    indicator = [{"t": row["t"], "value": row["adx"]} for _, row in df.iterrows()]
    output = {"indicator": indicator, "candles": orig_candles}
    return clean_json(output)

def macd_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute MACD (fast, slow, signal) for given candle data.

    Returns dict with:
      - "macd":     list of {t, value}
      - "signal":   list of {t, value}
      - "histogram":list of {t, value}
      - "candles":  original candle arrays
      or {"error": message} on failure.
    """
    # 1. Validate periods
    fast_raw   = payload.get("fast_length")
    slow_raw   = payload.get("slow_length")
    sig_raw    = payload.get("signal_length")
    raw_data   = payload.get("candle_data")
    if fast_raw is None or slow_raw is None or sig_raw is None or raw_data is None:
        return {"error": "fast_length, slow_length, signal_length, and candle_data are required"}

    try:
        fast = int(fast_raw)
        slow = int(slow_raw)
        sig  = int(sig_raw)
        if fast < 1 or slow < 1 or sig < 1:
            raise ValueError
    except Exception:
        return {"error": "fast_length, slow_length, and signal_length must be positive integers"}

    # 2. Parse candle_data JSON or list
    if isinstance(raw_data, str):
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return {"error": "candle_data must be valid JSON string or array of objects"}
    else:
        parsed = raw_data

    # 3. Normalize to DataFrame
    if isinstance(parsed, dict):
        keys = ["t","o","h","l","c","v"]
        if not all(k in parsed and isinstance(parsed[k], list) for k in keys):
            return {"error": "candle_data JSON must have keys t,o,h,l,c,v arrays"}
        parsed["t"] = [
            t[:10] if isinstance(t, str) and len(t) >= 10 else t
            for t in parsed["t"]
        ]
        df = pd.DataFrame({k: parsed[k] for k in keys})
        orig_candles = parsed
    elif isinstance(parsed, list):
        if not parsed:
            return {"error": "candle_data array cannot be empty"}
        records = []
        for bar in parsed:
            t_val = bar.get("timestamp") or bar.get("t")
            if isinstance(t_val, str) and len(t_val) >= 10:
                t_val = t_val[:10]
            records.append({
                "t": t_val,
                "o": bar.get("open") or bar.get("o"),
                "h": bar.get("high") or bar.get("h"),
                "l": bar.get("low") or bar.get("l"),
                "c": bar.get("close") or bar.get("c"),
                "v": bar.get("volume") or bar.get("v"),
            })
        df = pd.DataFrame(records)
        orig_candles = to_dict_of_arrays(records)
    else:
        return {"error": "Unsupported candle_data format"}

    # 4. Compute MACD
    try:
        macd_line, signal_line, hist_line = talib.MACD(
            df["c"],
            fastperiod=fast,
            slowperiod=slow,
            signalperiod=sig
        )
    except Exception as exc:
        return {"error": f"Error during MACD calculation: {exc}"}

    df["macd"]     = macd_line
    df["signal"]   = signal_line
    df["histogram"]= hist_line

    # 5. Clean and build output lists
    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    macd_list     = [{"t": row["t"], "value": row["macd"]}     for _, row in df.iterrows()]
    signal_list   = [{"t": row["t"], "value": row["signal"]}   for _, row in df.iterrows()]
    hist_list     = [{"t": row["t"], "value": row["histogram"]} for _, row in df.iterrows()]

    return clean_json({
        "macd":      macd_list,
        "signal":    signal_list,
        "histogram": hist_list,
        "candles":   orig_candles
    })

def stochastic_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute Stochastic Oscillator (%K and %D) for given candle data.

    Returns dict with:
      - "k": list of {"t", "value"}
      - "d": list of {"t", "value"}
      - "candles": original candle arrays
      or {"error": message} on failure.
    """
    raw_data    = payload.get("candle_data")
    k_raw       = payload.get("k_period")
    d_raw       = payload.get("d_period")
    smooth_raw  = payload.get("smooth")
    if raw_data is None or k_raw is None or d_raw is None or smooth_raw is None:
        return {"error": "k_period, d_period, smooth, and candle_data are required"}

    try:
        k_period      = int(k_raw)
        d_period      = int(d_raw)
        smooth_period = int(smooth_raw)
        if k_period < 1 or d_period < 1 or smooth_period < 1:
            raise ValueError
    except Exception:
        return {"error": "k_period, d_period, and smooth must be positive integers"}

    if isinstance(raw_data, str):
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return {"error": "candle_data must be valid JSON string or array of objects"}
    else:
        parsed = raw_data

    # normalize into DataFrame + save candles
    if isinstance(parsed, dict):
        keys = ["t","h","l","c","o","v"]
        if not all(k in parsed and isinstance(parsed[k], list) for k in keys):
            return {"error": "candle_data JSON must have keys t,o,h,l,c,v arrays"}
        parsed["t"] = [t[:10] if isinstance(t, str) and len(t) >= 10 else t for t in parsed["t"]]
        df = pd.DataFrame({k: parsed[k] for k in keys})
        orig_candles = parsed
    elif isinstance(parsed, list):
        if not parsed:
            return {"error": "candle_data array cannot be empty"}
        records = []
        for bar in parsed:
            t_val = bar.get("timestamp") or bar.get("t")
            if isinstance(t_val, str) and len(t_val) >= 10:
                t_val = t_val[:10]
            records.append({
                "t": t_val,
                "h": bar.get("high")   or bar.get("h"),
                "l": bar.get("low")    or bar.get("l"),
                "c": bar.get("close")  or bar.get("c"),
                "o": bar.get("open")   or bar.get("o"),
                "v": bar.get("volume") or bar.get("v"),
            })
        df = pd.DataFrame(records)
        orig_candles = to_dict_of_arrays(records)
    else:
        return {"error": "Unsupported candle_data format"}

    required = max(k_period, d_period, smooth_period)
    if len(df) < required:
        return {"error": f"Not enough candles for Stochastic (need at least {required})."}

    try:
        slowk, slowd = talib.STOCH(
            df["h"], df["l"], df["c"],
            fastk_period=k_period,
            slowk_period=smooth_period,
            slowk_matype=0,
            slowd_period=d_period,
            slowd_matype=0
        )
    except Exception as exc:
        return {"error": f"Error during Stochastic calculation: {exc}"}

    df["k"] = slowk
    df["d"] = slowd

    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    k_list = [{"t": row["t"], "value": row["k"]} for _, row in df.iterrows()]
    d_list = [{"t": row["t"], "value": row["d"]} for _, row in df.iterrows()]

    return clean_json({
        "k": k_list,
        "d": d_list,
        "candles": orig_candles
    })

def bollinger_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute Bollinger Bands (middle, upper, lower) for given candle data.

    Returns dict with:
      - "middle": list of {"t", "value"}
      - "upper":  list of {"t", "value"}
      - "lower":  list of {"t", "value"}
      - "candles": original candle arrays
      or {"error": message} on failure.
    """
    raw_data        = payload.get("candle_data")
    window_raw      = payload.get("window")
    std_raw         = payload.get("std_dev_multiplier")
    if raw_data is None or window_raw is None or std_raw is None:
        return {"error": "window, std_dev_multiplier, and candle_data are required"}

    try:
        window        = int(window_raw)
        std_dev       = float(std_raw)
        if window < 1 or std_dev < 0:
            raise ValueError
    except Exception:
        return {"error": "window must be a positive integer and std_dev_multiplier non‑negative"}

    # parse candle_data JSON or list
    if isinstance(raw_data, str):
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return {"error": "candle_data must be valid JSON string or array of objects"}
    else:
        parsed = raw_data

    # normalize into DataFrame + save original candles
    if isinstance(parsed, dict):
        keys = ["t","o","h","l","c","v"]
        if not all(k in parsed and isinstance(parsed[k], list) for k in keys):
            return {"error": "candle_data JSON must have keys t,o,h,l,c,v arrays"}
        parsed["t"] = [
            t[:10] if isinstance(t, str) and len(t) >= 10 else t
            for t in parsed["t"]
        ]
        df = pd.DataFrame({k: parsed[k] for k in keys})
        orig_candles = parsed
    elif isinstance(parsed, list):
        if not parsed:
            return {"error": "candle_data array cannot be empty"}
        records = []
        for bar in parsed:
            t_val = bar.get("timestamp") or bar.get("t")
            if isinstance(t_val, str) and len(t_val) >= 10:
                t_val = t_val[:10]
            records.append({
                "t": t_val,
                "o": bar.get("open")   or bar.get("o"),
                "h": bar.get("high")   or bar.get("h"),
                "l": bar.get("low")    or bar.get("l"),
                "c": bar.get("close")  or bar.get("c"),
                "v": bar.get("volume") or bar.get("v"),
            })
        df = pd.DataFrame(records)
        orig_candles = to_dict_of_arrays(records)
    else:
        return {"error": "Unsupported candle_data format"}

    if len(df) < window:
        return {"error": f"Not enough candles for Bollinger Bands (need at least {window})."}

    # compute Bollinger Bands
    try:
        upper, middle, lower = talib.BBANDS(
            df["c"],
            timeperiod=window,
            nbdevup=std_dev,
            nbdevdn=std_dev,
            matype=0
        )
    except Exception as exc:
        return {"error": f"Error during Bollinger Bands calculation: {exc}"}

    df["middle"] = middle
    df["upper"]  = upper
    df["lower"]  = lower

    # clean & format output
    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    middle_list = [{"t": row["t"], "value": row["middle"]} for _, row in df.iterrows()]
    upper_list  = [{"t": row["t"], "value": row["upper"]}  for _, row in df.iterrows()]
    lower_list  = [{"t": row["t"], "value": row["lower"]}  for _, row in df.iterrows()]

    return clean_json({
        "middle": middle_list,
        "upper":  upper_list,
        "lower":  lower_list,
        "candles": orig_candles
    })

def ichimoku_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute Ichimoku Cloud lines for given candle data.

    Returns dict with:
      - "conversion":      list of {"t", "value"}
      - "base":            list of {"t", "value"}
      - "leading_span_a":  list of {"t", "value"} (shifted by displacement)
      - "leading_span_b":  list of {"t", "value"} (shifted by displacement)
      - "candles":         original candle arrays
      or {"error": message} on failure.
    """
    raw_data       = payload.get("candle_data")
    conv_raw       = payload.get("conversion_period")
    base_raw       = payload.get("base_period")
    span_b_raw     = payload.get("leading_span_b_period")
    disp_raw       = payload.get("displacement")
    if raw_data is None or conv_raw is None or base_raw is None or span_b_raw is None or disp_raw is None:
        return {"error": "conversion_period, base_period, leading_span_b_period, displacement, and candle_data are required"}

    try:
        conv_p       = int(conv_raw)
        base_p       = int(base_raw)
        span_b_p     = int(span_b_raw)
        disp         = int(disp_raw)
        if conv_p < 1 or base_p < 1 or span_b_p < 1 or disp < 0:
            raise ValueError
    except Exception:
        return {"error": "conversion_period, base_period, leading_span_b_period must be positive integers and displacement non‑negative"}

    # parse candle_data
    if isinstance(raw_data, str):
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return {"error": "candle_data must be valid JSON string or array of objects"}
    else:
        parsed = raw_data

    # normalize to DataFrame + save original candles
    if isinstance(parsed, dict):
        keys = ["t","o","h","l","c","v"]
        if not all(k in parsed and isinstance(parsed[k], list) for k in keys):
            return {"error": "candle_data JSON must have keys t,o,h,l,c,v arrays"}
        parsed["t"] = [t[:10] if isinstance(t, str) and len(t) >= 10 else t for t in parsed["t"]]
        df = pd.DataFrame({k: parsed[k] for k in keys})
        orig_candles = parsed
    elif isinstance(parsed, list):
        if not parsed:
            return {"error": "candle_data array cannot be empty"}
        records = []
        for bar in parsed:
            t_val = bar.get("timestamp") or bar.get("t")
            if isinstance(t_val, str) and len(t_val) >= 10:
                t_val = t_val[:10]
            records.append({
                "t": t_val,
                "o": bar.get("open")   or bar.get("o"),
                "h": bar.get("high")   or bar.get("h"),
                "l": bar.get("low")    or bar.get("l"),
                "c": bar.get("close")  or bar.get("c"),
                "v": bar.get("volume") or bar.get("v"),
            })
        df = pd.DataFrame(records)
        orig_candles = to_dict_of_arrays(records)
    else:
        return {"error": "Unsupported candle_data format"}

    # ensure enough data
    if len(df) < max(conv_p, base_p, span_b_p):
        return {"error": f"Not enough candles for Ichimoku (need at least {max(conv_p, base_p, span_b_p)})."}

    # compute Ichimoku lines
    try:
        conv_line, base_line, span_a, span_b = talib.ICHIMOKU(
            df["h"], df["l"],
            conversion_period=conv_p,
            base_period=base_p,
            span_b_period=span_b_p
        )
    except Exception as exc:
        return {"error": f"Error during Ichimoku calculation: {exc}"}

    df["conversion"]     = conv_line
    df["base"]           = base_line
    df["leading_span_a"] = span_a.shift(disp)
    df["leading_span_b"] = span_b.shift(disp)

    # clean & format output
    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    conv_list  = [{"t": row["t"], "value": row["conversion"]}     for _, row in df.iterrows()]
    base_list  = [{"t": row["t"], "value": row["base"]}           for _, row in df.iterrows()]
    span_a_list= [{"t": row["t"], "value": row["leading_span_a"]} for _, row in df.iterrows()]
    span_b_list= [{"t": row["t"], "value": row["leading_span_b"]} for _, row in df.iterrows()]

    return clean_json({
        "conversion":      conv_list,
        "base":            base_list,
        "leading_span_a":  span_a_list,
        "leading_span_b":  span_b_list,
        "candles":         orig_candles
    })

def obv_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute On‑Balance Volume (OBV) for given candle data.

    Returns dict with:
      - "obv":     list of {"t", "value"}
      - "candles": original candle arrays
      or {"error": message} on failure.
    """
    raw_data = payload.get("candle_data")
    if raw_data is None:
        return {"error": "candle_data is required"}

    # parse candle_data JSON or list
    if isinstance(raw_data, str):
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return {"error": "candle_data must be valid JSON string or array of objects"}
    else:
        parsed = raw_data

    # normalize into DataFrame + save original candles
    if isinstance(parsed, dict):
        keys = ["t","o","h","l","c","v"]
        if not all(k in parsed and isinstance(parsed[k], list) for k in keys):
            return {"error": "candle_data JSON must have keys t,o,h,l,c,v arrays"}
        parsed["t"] = [
            t[:10] if isinstance(t, str) and len(t) >= 10 else t
            for t in parsed["t"]
        ]
        df = pd.DataFrame({k: parsed[k] for k in keys})
        orig_candles = parsed
    elif isinstance(parsed, list):
        if not parsed:
            return {"error": "candle_data array cannot be empty"}
        records = []
        for bar in parsed:
            t_val = bar.get("timestamp") or bar.get("t")
            if isinstance(t_val, str) and len(t_val) >= 10:
                t_val = t_val[:10]
            records.append({
                "t": t_val,
                "o": bar.get("open")   or bar.get("o"),
                "h": bar.get("high")   or bar.get("h"),
                "l": bar.get("low")    or bar.get("l"),
                "c": bar.get("close")  or bar.get("c"),
                "v": bar.get("volume") or bar.get("v"),
            })
        df = pd.DataFrame(records)
        orig_candles = to_dict_of_arrays(records)
    else:
        return {"error": "Unsupported candle_data format"}

    # compute OBV
    try:
        obv_series = talib.OBV(df["c"], df["v"])
    except Exception as exc:
        return {"error": f"Error during OBV calculation: {exc}"}

    df["obv"] = obv_series

    # clean & format output
    df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
    obv_list = [{"t": row["t"], "value": row["obv"]} for _, row in df.iterrows()]

    return clean_json({
        "obv":      obv_list,
        "candles":  orig_candles
    })

def vwap_func(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compute Volume‐Weighted Average Price (VWAP) for given candle data.

    Supports session_type:
      - "daily":   VWAP resets each calendar day
      - "weekly":  VWAP resets each ISO week
      - "custom":  VWAP from custom_start_time onward
    Returns:
      - "vwap":    list of {"t", "value"}
      - "candles": original candle arrays
      or {"error": message} on failure.
    """
    raw_data = payload.get("candle_data")
    session  = payload.get("session_type")
    custom_t = payload.get("custom_start_time")

    if raw_data is None or session is None:
        return {"error": "candle_data and session_type are required"}

    session = session.lower()
    if session not in {"daily", "weekly", "custom"}:
        return {"error": "session_type must be one of daily, weekly, custom"}

    # parse JSON
    if isinstance(raw_data, str):
        try:
            parsed = json.loads(raw_data)
        except json.JSONDecodeError:
            return {"error": "candle_data must be valid JSON string or array of objects"}
    else:
        parsed = raw_data

    # build DataFrame with full timestamp
    if isinstance(parsed, dict):
        # dict of arrays
        df = pd.DataFrame(parsed)
        df["datetime"] = pd.to_datetime(parsed["t"])
        orig_candles = parsed
    elif isinstance(parsed, list):
        if not parsed:
            return {"error": "candle_data array cannot be empty"}
        records = []
        for bar in parsed:
            t_str = bar.get("timestamp") or bar.get("t")
            dt = pd.to_datetime(t_str)
            records.append({
                "t":        t_str,
                "datetime": dt,
                "o":        bar.get("open")   or bar.get("o"),
                "h":        bar.get("high")   or bar.get("h"),
                "l":        bar.get("low")    or bar.get("l"),
                "c":        bar.get("close")  or bar.get("c"),
                "v":        bar.get("volume") or bar.get("v"),
            })
        df = pd.DataFrame(records)
        orig_candles = to_dict_of_arrays(records)
    else:
        return {"error": "Unsupported candle_data format"}

    # filter for custom session
    if session == "custom":
        if not custom_t:
            return {"error": "custom_start_time is required for custom session"}
        try:
            start_dt = pd.to_datetime(custom_t)
        except Exception:
            return {"error": "custom_start_time must be a valid ISO datetime"}
        df = df[df["datetime"] >= start_dt]
        if df.empty:
            return {"error": "No data after custom_start_time"}

    # assign group keys
    if session == "daily":
        df["group"] = df["datetime"].dt.date
    elif session == "weekly":
        df["group"] = df["datetime"].dt.to_period("W").astype(str)
    else:  # custom
        df["group"] = "custom"

    # sort and compute VWAP per group
    result = []
    for _, group_df in df.groupby("group", sort=False):
        group_df = group_df.sort_values("datetime")
        cum_v  = group_df["v"].cumsum()
        cum_pv = (group_df["c"] * group_df["v"]).cumsum()
        vwap   = cum_pv / cum_v
        for idx, row in group_df.iterrows():
            result.append({"t": row["t"], "value": float(vwap.loc[idx])})

    return clean_json({
        "vwap":    result,
        "candles": orig_candles
    })


# --- Pydantic request schemas for each indicator ---
class BaseIndicatorRequest(BaseModel):
    user_id: str
    candle_data: Any

class EMARequest(BaseIndicatorRequest):
    window: int

class RSIRequest(BaseIndicatorRequest):
    window: int

class ADXRequest(BaseIndicatorRequest):
    window: int

class MACDRequest(BaseIndicatorRequest):
    fast_length:   int
    slow_length:   int
    signal_length: int

class StochasticRequest(BaseIndicatorRequest):
    k_period:  int
    d_period:  int
    smooth:    int

class BollingerRequest(BaseIndicatorRequest):
    window: int
    std_dev_multiplier: float

class IchimokuRequest(BaseIndicatorRequest):
    conversion_period:        int
    base_period:              int
    leading_span_b_period:    int
    displacement:             int

class OBVRequest(BaseIndicatorRequest):
    pass

class VWAPRequest(BaseIndicatorRequest):
    session_type:       str
    custom_start_time:  Optional[str] = None

# --- Unified map of name → (func, model) ---
indicator_map = {
    "ema": {"func": ema_func, "model": EMARequest},
    "rsi": {"func": rsi_func, "model": RSIRequest},
    "adx": {"func": adx_func, "model": ADXRequest},
    "macd": {"func": macd_func, "model": MACDRequest},
    "stochastic": {"func": stochastic_func, "model": StochasticRequest},
    "bollinger":  {"func": bollinger_func,  "model": BollingerRequest},
    "ichimoku":   {"func": ichimoku_func,   "model": IchimokuRequest},
    "obv":        {"func": obv_func,        "model": OBVRequest},
    "vwap":       {"func": vwap_func,       "model": VWAPRequest},
}
