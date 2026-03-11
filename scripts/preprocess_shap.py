"""
preprocess_shap.py — Train 6 XGBoost models and compute TreeSHAP values

For each of 6 perception dimensions (safer, livelier, wealthier,
more_beautiful, more_boring, more_depressing):
  1. Train an XGBoost regressor: features (23-dim) -> perception score
  2. Evaluate on held-out test set (R², MAE, RMSE)
  3. Compute TreeSHAP values for ALL 178K points
  4. Save SHAP values, base values, and model evaluation metrics

Output to data/sphere/:
  - shap_values/{dim}.npy         float32 (N, 23) per dimension
  - shap_values/base_values.json  base value per dimension
  - models/{dim}_eval.json        model performance metrics
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error

SPHERE_DIR = Path("/data2/shared/haoxi/projects/ZenSVI/HCMC_Tour/data/sphere")
SHAP_DIR = SPHERE_DIR / "shap_values"
MODELS_DIR = SPHERE_DIR / "models"

PERCEPTION_DIMS = [
    "safer", "livelier", "wealthier",
    "more_beautiful", "more_boring", "more_depressing",
]


def train_and_explain(X, y, dim_name, dim_idx):
    """Train XGBoost, evaluate, compute SHAP for one perception dimension."""
    print(f"\n{'─' * 50}")
    print(f"  Dimension: {dim_name} (col {dim_idx})")
    print(f"{'─' * 50}")

    # Identify valid points (non-zero perception — already confirmed all non-zero,
    # but keep this guard for robustness)
    valid_mask = y > 0.0
    n_valid = valid_mask.sum()
    n_total = len(y)
    print(f"  Valid samples: {n_valid}/{n_total} ({100*n_valid/n_total:.1f}%)")

    X_valid = X[valid_mask]
    y_valid = y[valid_mask]

    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X_valid, y_valid, test_size=0.2, random_state=42
    )
    print(f"  Train: {len(X_train)}, Test: {len(X_test)}")

    # Train XGBoost
    t0 = time.time()
    model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        tree_method="hist",
        random_state=42,
        verbosity=0,
    )
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )
    train_time = time.time() - t0
    print(f"  Training time: {train_time:.1f}s")

    # Evaluate
    y_pred = model.predict(X_test)
    r2 = r2_score(y_test, y_pred)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    print(f"  R²:   {r2:.4f}")
    print(f"  MAE:  {mae:.4f}")
    print(f"  RMSE: {rmse:.4f}")

    # Feature importance (top 5)
    importances = model.feature_importances_
    top5_idx = np.argsort(importances)[::-1][:5]
    with open(SPHERE_DIR / "feature_names.json") as f:
        fnames = json.load(f)["feature_names"]
    print(f"  Top 5 features:")
    for rank, idx in enumerate(top5_idx):
        print(f"    {rank+1}. {fnames[idx]:25s} importance={importances[idx]:.4f}")

    # Save evaluation
    eval_data = {
        "dimension": dim_name,
        "n_train": int(len(X_train)),
        "n_test": int(len(X_test)),
        "n_total": int(n_total),
        "n_valid": int(n_valid),
        "r2": float(r2),
        "mae": float(mae),
        "rmse": float(rmse),
        "train_time_s": float(train_time),
        "best_iteration": int(model.best_iteration) if hasattr(model, "best_iteration") and model.best_iteration is not None else int(model.n_estimators),
        "feature_importance": {fnames[i]: float(importances[i]) for i in range(len(fnames))},
    }
    eval_path = MODELS_DIR / f"{dim_name}_eval.json"
    with open(eval_path, "w") as f:
        json.dump(eval_data, f, indent=2)

    # Compute SHAP values for ALL points using XGBoost's native TreeSHAP
    # (avoids shap library compatibility issues with newer XGBoost versions)
    print(f"  Computing TreeSHAP for all {n_total} points...")
    t0 = time.time()
    booster = model.get_booster()
    dmatrix = xgb.DMatrix(X, feature_names=[f"f{i}" for i in range(X.shape[1])])
    # pred_contribs returns shape (N, n_features + 1) where last col is base value
    contribs = booster.predict(dmatrix, pred_contribs=True)
    shap_values = contribs[:, :-1]  # (N, 23)
    base_value = float(contribs[0, -1])  # base value is same for all points
    shap_time = time.time() - t0
    print(f"  SHAP time: {shap_time:.1f}s")
    print(f"  Base value (E[f(x)]): {base_value:.4f}")
    print(f"  SHAP range: [{shap_values.min():.4f}, {shap_values.max():.4f}]")

    # Save SHAP values
    shap_array = shap_values.astype(np.float32)
    shap_path = SHAP_DIR / f"{dim_name}.npy"
    np.save(shap_path, shap_array)
    print(f"  Saved: {shap_path.name} ({shap_path.stat().st_size / 1e6:.1f} MB)")

    return base_value, eval_data


def main():
    start = time.time()
    print("=" * 60)
    print("PerceptionSphere SHAP Computation")
    print("=" * 60)

    # Load data
    print("\nLoading features and perception scores...")
    X = np.load(SPHERE_DIR / "features.npy")
    perception = np.load(SPHERE_DIR / "perception_scores.npy")
    print(f"  Features: {X.shape}")
    print(f"  Perception: {perception.shape}")

    # Create output dirs
    SHAP_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Train and compute SHAP for each dimension
    base_values = {}
    all_evals = {}
    total_dims = len(PERCEPTION_DIMS)

    for dim_idx, dim_name in enumerate(PERCEPTION_DIMS):
        progress = dim_idx / total_dims
        bar = "#" * int(progress * 30) + "-" * (30 - int(progress * 30))
        elapsed_so_far = time.time() - start
        eta = (elapsed_so_far / max(dim_idx, 1)) * (total_dims - dim_idx) if dim_idx > 0 else 0
        print(f"\n  PROGRESS: [{bar}] {dim_idx}/{total_dims} | Elapsed: {elapsed_so_far:.0f}s | ETA: ~{eta:.0f}s", flush=True)

        y = perception[:, dim_idx]
        base_val, eval_data = train_and_explain(X, y, dim_name, dim_idx)
        base_values[dim_name] = base_val
        all_evals[dim_name] = {
            "r2": eval_data["r2"],
            "mae": eval_data["mae"],
            "rmse": eval_data["rmse"],
        }

    print(f"\n  PROGRESS: [{'#' * 30}] {total_dims}/{total_dims} | COMPLETE", flush=True)

    # Save base values
    bv_path = SHAP_DIR / "base_values.json"
    with open(bv_path, "w") as f:
        json.dump(base_values, f, indent=2)
    print(f"\nSaved base values to {bv_path.name}")

    # Summary
    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"All done in {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"\nModel Performance Summary:")
    print(f"  {'Dimension':20s} {'R²':>8s} {'MAE':>8s} {'RMSE':>8s}")
    print(f"  {'─'*20} {'─'*8} {'─'*8} {'─'*8}")
    for dim in PERCEPTION_DIMS:
        e = all_evals[dim]
        print(f"  {dim:20s} {e['r2']:8.4f} {e['mae']:8.4f} {e['rmse']:8.4f}")


if __name__ == "__main__":
    main()
