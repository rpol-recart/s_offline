---
name: timeseries-eda
description: "Time series EDA — decomposition, stationarity, ACF/PACF, anomaly detection, forecasting prep"
---

# Time Series EDA Skill

## When to Use

When performing exploratory data analysis on time-series data — sensor readings, metrics, financial data, IoT streams, video analytics aggregates.

## EDA Workflow

```
1. Load & inspect → 2. Clean & resample → 3. Visualize → 4. Decompose →
5. Stationarity test → 6. ACF/PACF → 7. Anomaly detection → 8. Feature engineering
```

## Step 1: Load & Inspect

```python
import pandas as pd
import numpy as np

# Load
df = pd.read_csv("data.csv", parse_dates=["timestamp"], index_col="timestamp")
# Or from ClickHouse
df = pd.DataFrame(client.query("SELECT * FROM metrics ORDER BY timestamp").result_rows)

# Basic inspection
print(f"Shape: {df.shape}")
print(f"Date range: {df.index.min()} → {df.index.max()}")
print(f"Frequency: {pd.infer_freq(df.index)}")
print(f"\n{df.describe()}")
print(f"\nMissing values:\n{df.isnull().sum()}")
print(f"\nDtypes:\n{df.dtypes}")

# Check for gaps
time_diffs = df.index.to_series().diff()
print(f"\nTime gaps stats:\n{time_diffs.describe()}")
gaps = time_diffs[time_diffs > time_diffs.median() * 3]
print(f"\nLarge gaps ({len(gaps)}):\n{gaps}")
```

## Step 2: Clean & Resample

```python
# Handle missing timestamps
df = df.asfreq('1min')                      # Set explicit frequency
df = df.resample('5min').mean()              # Downsample
df = df.resample('1min').interpolate('time') # Upsample with interpolation

# Handle missing values
df['value'] = df['value'].interpolate(method='time')   # Time-weighted
df['value'] = df['value'].fillna(method='ffill', limit=5)  # Forward fill max 5

# Remove duplicates
df = df[~df.index.duplicated(keep='last')]

# Handle outliers (IQR method)
Q1, Q3 = df['value'].quantile([0.25, 0.75])
IQR = Q3 - Q1
mask = (df['value'] >= Q1 - 1.5 * IQR) & (df['value'] <= Q3 + 1.5 * IQR)
df_clean = df[mask]

# Timezone handling
df.index = df.index.tz_localize('UTC').tz_convert('Europe/Moscow')
```

## Step 3: Visualize

```python
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

fig, axes = plt.subplots(4, 1, figsize=(14, 12), sharex=True)

# Raw time series
axes[0].plot(df.index, df['value'], linewidth=0.5)
axes[0].set_title("Raw Time Series")

# Rolling statistics
window = 24  # e.g., 24 hours
rolling_mean = df['value'].rolling(window).mean()
rolling_std = df['value'].rolling(window).std()
axes[1].plot(df.index, df['value'], alpha=0.3, label='Raw')
axes[1].plot(df.index, rolling_mean, color='red', label=f'Rolling Mean ({window})')
axes[1].fill_between(df.index, rolling_mean - 2*rolling_std, rolling_mean + 2*rolling_std, alpha=0.1)
axes[1].legend()
axes[1].set_title("Rolling Statistics")

# Distribution over time (box plot by day/hour)
df['hour'] = df.index.hour
df.boxplot(column='value', by='hour', ax=axes[2])
axes[2].set_title("Distribution by Hour")

# Histogram
axes[3].hist(df['value'], bins=50, edgecolor='black')
axes[3].set_title("Value Distribution")

plt.tight_layout()
plt.savefig("eda_overview.png", dpi=150)
```

## Step 4: Decomposition

```python
from statsmodels.tsa.seasonal import seasonal_decompose, STL

# Classical decomposition
decomposition = seasonal_decompose(
    df['value'],
    model='additive',    # or 'multiplicative'
    period=24,            # Seasonal period (e.g., 24 hours)
)

fig = decomposition.plot()
fig.set_size_inches(14, 10)
plt.savefig("decomposition.png", dpi=150)

# STL decomposition (robust to outliers)
stl = STL(df['value'], period=24, robust=True)
result = stl.fit()

trend = result.trend
seasonal = result.seasonal
residual = result.resid
```

## Step 5: Stationarity Tests

```python
from statsmodels.tsa.stattools import adfuller, kpss

# Augmented Dickey-Fuller test
# H0: Series has unit root (non-stationary)
adf_result = adfuller(df['value'].dropna())
print(f"ADF Statistic: {adf_result[0]:.4f}")
print(f"p-value: {adf_result[1]:.4f}")
print(f"Stationary: {'Yes' if adf_result[1] < 0.05 else 'No'}")

# KPSS test
# H0: Series is stationary
kpss_stat, kpss_p, _, kpss_crit = kpss(df['value'].dropna(), regression='c')
print(f"KPSS Statistic: {kpss_stat:.4f}")
print(f"p-value: {kpss_p:.4f}")
print(f"Stationary: {'Yes' if kpss_p > 0.05 else 'No'}")

# Make stationary if needed
df['value_diff'] = df['value'].diff()          # First difference
df['value_log_diff'] = np.log(df['value']).diff()  # Log + diff
```

## Step 6: ACF / PACF

```python
from statsmodels.graphics.tsaplots import plot_acf, plot_pacf

fig, axes = plt.subplots(1, 2, figsize=(14, 5))

plot_acf(df['value'].dropna(), lags=48, ax=axes[0])
axes[0].set_title("ACF")

plot_pacf(df['value'].dropna(), lags=48, ax=axes[1], method='ywm')
axes[1].set_title("PACF")

plt.tight_layout()
plt.savefig("acf_pacf.png", dpi=150)

# Interpretation:
# ACF decays slowly → non-stationary, need differencing
# ACF cuts off at lag k → MA(k) model
# PACF cuts off at lag p → AR(p) model
# Both decay → ARMA model
# Seasonal spikes at lag s, 2s, 3s → seasonal component
```

## Step 7: Anomaly Detection

```python
# Z-score method
from scipy import stats

z_scores = np.abs(stats.zscore(df['value'].dropna()))
anomalies_z = df[z_scores > 3]

# Rolling statistics method
rolling_mean = df['value'].rolling(window=24).mean()
rolling_std = df['value'].rolling(window=24).std()
anomalies_rolling = df[
    (df['value'] > rolling_mean + 3 * rolling_std) |
    (df['value'] < rolling_mean - 3 * rolling_std)
]

# Isolation Forest
from sklearn.ensemble import IsolationForest

features = df[['value']].copy()
features['hour'] = df.index.hour
features['dayofweek'] = df.index.dayofweek

iso_forest = IsolationForest(contamination=0.01, random_state=42)
df['anomaly'] = iso_forest.fit_predict(features.dropna())
anomalies_if = df[df['anomaly'] == -1]
```

## Step 8: Feature Engineering

```python
# Calendar features
df['hour'] = df.index.hour
df['dayofweek'] = df.index.dayofweek
df['month'] = df.index.month
df['is_weekend'] = df['dayofweek'].isin([5, 6]).astype(int)

# Lag features
for lag in [1, 6, 12, 24]:
    df[f'lag_{lag}'] = df['value'].shift(lag)

# Rolling features
for window in [6, 12, 24]:
    df[f'rolling_mean_{window}'] = df['value'].rolling(window).mean()
    df[f'rolling_std_{window}'] = df['value'].rolling(window).std()
    df[f'rolling_min_{window}'] = df['value'].rolling(window).min()
    df[f'rolling_max_{window}'] = df['value'].rolling(window).max()

# Exponential moving average
df['ema_12'] = df['value'].ewm(span=12).mean()
df['ema_24'] = df['value'].ewm(span=24).mean()

# Diff features
df['diff_1'] = df['value'].diff(1)
df['diff_24'] = df['value'].diff(24)   # Same hour yesterday
```

## Quick EDA Report Template

```python
def quick_eda_report(df, value_col='value', period=24):
    """Generate a quick EDA report for time series."""
    print("=" * 60)
    print("TIME SERIES EDA REPORT")
    print("=" * 60)

    print(f"\n--- Data Overview ---")
    print(f"Records: {len(df):,}")
    print(f"Date range: {df.index.min()} → {df.index.max()}")
    print(f"Duration: {df.index.max() - df.index.min()}")
    print(f"Frequency: {pd.infer_freq(df.index)}")
    print(f"Missing: {df[value_col].isnull().sum()} ({df[value_col].isnull().mean():.1%})")

    print(f"\n--- Statistics ---")
    print(df[value_col].describe())

    print(f"\n--- Stationarity (ADF) ---")
    adf = adfuller(df[value_col].dropna())
    print(f"Statistic: {adf[0]:.4f}, p-value: {adf[1]:.4f}")
    print(f"Stationary: {'Yes' if adf[1] < 0.05 else 'No — consider differencing'}")

    print(f"\n--- Seasonality ---")
    decomp = seasonal_decompose(df[value_col].dropna(), period=period)
    seasonal_strength = 1 - (decomp.resid.var() / (decomp.seasonal + decomp.resid).var())
    print(f"Seasonal strength: {seasonal_strength:.2f} (>0.6 = strong)")

    print(f"\n--- Anomalies (3σ) ---")
    z = np.abs(stats.zscore(df[value_col].dropna()))
    print(f"Anomalies: {(z > 3).sum()} ({(z > 3).mean():.2%})")
```

## Best Practices

1. **Always check frequency** — `pd.infer_freq()`, handle irregular timestamps
2. **Visualize first** — plot raw data before any analysis
3. **Test stationarity** — use both ADF and KPSS for confirmation
4. **Proper train/test split** — chronological only, never random
5. **Handle timezone** — normalize to UTC internally, display in local TZ
6. **Log transform** — for multiplicative seasonality or right-skewed data
7. **Multiple seasonalities** — check daily (24), weekly (168), monthly patterns
8. **Document findings** — save plots and statistics for reproducibility
