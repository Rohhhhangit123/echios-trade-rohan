"""
One-off script: convert simulated_<TICKER>_live.csv files into
per-ticker parquet files for the live-tick replay system.

Usage:
    python convert_to_parquet.py --input-dir ./csvs --output-dir ./data/live

Input files expected to be named like:
    simulated_AAPL_live.csv
    simulated_MSFT_live.csv
    ...

Output:
    ./data/live/AAPL.parquet
    ./data/live/MSFT.parquet
    ...

Each output parquet has columns:
timestamp, open, high, low, close, volume

sorted ascending by timestamp, with a clean 0..N-1 row index (this row
index is what the live-replay "elapsed_seconds % total_candles" logic
will use to look up the current candle).

RUN AS: python script.py --input-dir ./excels --output-dir ./data/live
"""

import argparse
import re
import sys
from pathlib import Path

import pandas as pd

# Matches: simulated_AAPL_live.csv -> AAPL
FILENAME_PATTERN = re.compile(r"simulated_(.+?)_live\.csv$", re.IGNORECASE)

EXPECTED_COLUMNS = ["timestamp", "open", "high", "low", "close", "volume"]


def extract_ticker(filename: str) -> str | None:
    match = FILENAME_PATTERN.match(filename)
    if not match:
        return None
    return match.group(1).upper()


def convert_file(csv_path: Path, output_dir: Path) -> None:
    ticker = extract_ticker(csv_path.name)
    if ticker is None:
        print(f"  SKIP  {csv_path.name} (doesn't match simulated_<TICKER>_live.csv)")
        return

    df = pd.read_csv(csv_path)

    # Normalize column names (lowercase, stripped)
    df.columns = [str(c).strip().lower() for c in df.columns]

    missing = [c for c in EXPECTED_COLUMNS if c not in df.columns]
    if missing:
        print(
            f"  FAIL  {csv_path.name}: missing columns {missing}, found {list(df.columns)}"
        )
        return

    df = df[EXPECTED_COLUMNS].copy()

    # Parse timestamps.
    # Example expected format: "30-06-2026 09:30"
    df["timestamp"] = pd.to_datetime(
       df["timestamp"],
       errors="raise",
    )

    df = df.sort_values("timestamp").reset_index(drop=True)

    # Basic sanity checks
    if df["timestamp"].duplicated().any():
        dup_count = df["timestamp"].duplicated().sum()
        print(f"  WARN  {ticker}: {dup_count} duplicate timestamps found")

    numeric_cols = ["open", "high", "low", "close", "volume"]
    if df[numeric_cols].isnull().any().any():
        print(f"  WARN  {ticker}: found NaN values in OHLCV columns")

    output_dir.mkdir(parents=True, exist_ok=True)

    out_path = output_dir / f"{ticker}.parquet"
    df.to_parquet(out_path, engine="pyarrow", index=False)

    print(f"  OK    {ticker}: {len(df)} rows -> {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        required=True,
        help="Folder containing simulated_<TICKER>_live.csv files",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Folder to write <TICKER>.parquet files into",
    )

    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)

    if not input_dir.exists():
        print(f"Input dir does not exist: {input_dir}")
        sys.exit(1)

    csv_files = sorted(input_dir.glob("*.csv"))

    if not csv_files:
        print(f"No .csv files found in {input_dir}")
        sys.exit(1)

    print(f"Found {len(csv_files)} CSV file(s) in {input_dir}\n")

    for csv_path in csv_files:
        convert_file(csv_path, output_dir)

    print("\nDone.")


if __name__ == "__main__":
    main()