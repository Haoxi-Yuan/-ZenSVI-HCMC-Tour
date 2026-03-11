"""
preprocess_embedding.py — Sphere embedding: map 178K sampling points to spherical coordinates

Two-phase hybrid embedding:
  Phase A: Build street adjacency graph from OSM road network
  Phase B: UMAP to sphere with topological regularization

The embedding encodes BOTH perception similarity (from concatenated SHAP profiles)
AND street network topology (from OSM adjacency), so that:
  - Perceptually similar points cluster together on the sphere
  - Street-adjacent points remain neighbors on the sphere

Output to data/sphere/:
  - adjacency_graph.json    point-to-point adjacency list
  - embedding.npy           float32 (N, 2) — (theta, phi) spherical coordinates
  - embedding_cartesian.npy float32 (N, 3) — (x, y, z) unit sphere coordinates
"""

import json
import sys
import time
from pathlib import Path

import networkx as nx
import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import shape
from sklearn.preprocessing import normalize

PROJECT_ROOT = Path("/data2/shared/haoxi/projects/ZenSVI")
SPHERE_DIR = PROJECT_ROOT / "HCMC_Tour" / "data" / "sphere"
SHAP_DIR = SPHERE_DIR / "shap_values"
OSM_ROADS = PROJECT_ROOT / "hochiminh_roads_centerlines.geojson"

PERCEPTION_DIMS = [
    "safer", "livelier", "wealthier",
    "more_beautiful", "more_boring", "more_depressing",
]

# Adjacency parameters
MAX_SNAP_DISTANCE_DEG = 0.002  # ~220m at HCMC latitude
MAX_NEIGHBOR_DISTANCE_DEG = 0.002  # ~220m

# Topological regularization
TOPO_ALPHA = 0.7  # weight for UMAP embedding preservation
TOPO_BETA = 0.3   # weight for topology preservation
TOPO_ITERATIONS = 500
TOPO_LR = 0.01


def build_adjacency_graph(metadata, verbose=True):
    """Build point-to-point adjacency from OSM road network."""
    t0 = time.time()
    N = len(metadata)

    if verbose:
        print(f"\n  Phase A: Building street adjacency graph")
        print(f"  Loading OSM roads: {OSM_ROADS.name}...")

    # Load OSM road network (use json directly — fiona chokes on array-typed fields)
    with open(str(OSM_ROADS)) as f:
        geojson_data = json.load(f)
    road_features = geojson_data["features"]
    if verbose:
        print(f"  Loaded {len(road_features)} road segments")

    # Build OSM node graph
    osm_graph = nx.Graph()
    for feat in road_features:
        props = feat.get("properties", {})
        u = props.get("u")
        v = props.get("v")
        if u is not None and v is not None:
            geom = shape(feat["geometry"])
            # Handle MultiLineString: extract coords from all parts
            if geom.geom_type == "MultiLineString":
                coords = []
                for part in geom.geoms:
                    coords.extend(list(part.coords))
            else:
                coords = list(geom.coords)
            osm_graph.add_edge(u, v, coords=coords)

    if verbose:
        print(f"  OSM graph: {osm_graph.number_of_nodes()} nodes, {osm_graph.number_of_edges()} edges")

    # Extract OSM node positions from edge geometries
    node_positions = {}
    for u, v, data in osm_graph.edges(data=True):
        coords = data.get("coords", [])
        if coords:
            if u not in node_positions:
                node_positions[u] = coords[0]  # (lon, lat)
            if v not in node_positions:
                node_positions[v] = coords[-1]

    # Build KD-tree of OSM nodes for snapping
    osm_node_ids = list(node_positions.keys())
    osm_node_coords = np.array([[node_positions[n][1], node_positions[n][0]]
                                 for n in osm_node_ids])  # (lat, lon)
    osm_tree = cKDTree(osm_node_coords)

    if verbose:
        print(f"  OSM nodes with positions: {len(osm_node_ids)}")

    # Snap each sampling point to nearest OSM node
    point_coords = np.array([[p["lat"], p["lon"]] for p in metadata])
    distances, indices = osm_tree.query(point_coords)

    # Build point -> OSM node mapping (only if within snap distance)
    point_to_osm = {}
    snapped_count = 0
    for i in range(N):
        if distances[i] <= MAX_SNAP_DISTANCE_DEG:
            point_to_osm[i] = osm_node_ids[indices[i]]
            snapped_count += 1

    if verbose:
        print(f"  Points snapped to OSM: {snapped_count}/{N} ({100*snapped_count/N:.1f}%)")

    # Build reverse mapping: OSM node -> list of point indices
    osm_to_points = {}
    for pt_idx, osm_node in point_to_osm.items():
        osm_to_points.setdefault(osm_node, []).append(pt_idx)

    # Build point-to-point adjacency
    # Two points are adjacent if:
    #   (a) They are snapped to the same OSM node, OR
    #   (b) They are snapped to OSM nodes connected by an edge
    adjacency = {i: set() for i in range(N)}

    # (a) Same OSM node
    for osm_node, pts in osm_to_points.items():
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                adjacency[pts[i]].add(pts[j])
                adjacency[pts[j]].add(pts[i])

    # (b) Connected OSM nodes
    for u, v in osm_graph.edges():
        pts_u = osm_to_points.get(u, [])
        pts_v = osm_to_points.get(v, [])
        for pu in pts_u:
            for pv in pts_v:
                adjacency[pu].add(pv)
                adjacency[pv].add(pu)

    # Also add KNN spatial neighbors for unsnapped points
    point_tree = cKDTree(point_coords)
    for i in range(N):
        if i not in point_to_osm:
            # Find K nearest spatial neighbors
            dists, idxs = point_tree.query(point_coords[i], k=7)
            for d, j in zip(dists[1:], idxs[1:]):
                if d <= MAX_NEIGHBOR_DISTANCE_DEG:
                    adjacency[i].add(j)
                    adjacency[j].add(i)

    # Convert to serializable format
    adj_list = {str(i): sorted([int(n) for n in neighbors])
                for i, neighbors in adjacency.items() if neighbors}

    total_edges = sum(len(v) for v in adjacency.values()) // 2
    avg_degree = np.mean([len(v) for v in adjacency.values()])

    if verbose:
        print(f"  Adjacency graph: {len(adj_list)} nodes with neighbors, {total_edges} edges")
        print(f"  Average degree: {avg_degree:.1f}")
        print(f"  Phase A time: {time.time() - t0:.1f}s")

    return adjacency, adj_list


def run_umap_embedding(shap_concatenated, adjacency, N, verbose=True):
    """Run adjacency-augmented UMAP to 3D, then project to unit sphere.

    Instead of post-hoc regularization (which was too weak, giving only ~4% recall),
    we inject street adjacency edges directly into UMAP's input graph. This lets UMAP
    jointly optimize for both perception similarity AND street topology.

    Strategy:
      1. Build SHAP cosine kNN graph (k=15)
      2. Build street adjacency sparse distance matrix
      3. Merge: union of kNN + adjacency edges (min distance where both exist)
      4. UMAP with metric='precomputed' on the combined graph
      5. Center + project to unit sphere
    """
    t0 = time.time()

    if verbose:
        print(f"\n  Phase B: Adjacency-augmented UMAP sphere embedding")
        print(f"  Input: {shap_concatenated.shape} (concatenated SHAP profiles)")

    # Normalize input for cosine distance computation
    shap_normed = normalize(shap_concatenated, norm='l2')

    # --- Step 1: Build SHAP-based kNN distance graph ---
    if verbose:
        print(f"  Step 1: Building SHAP kNN graph (k=15, cosine)...", flush=True)

    from sklearn.neighbors import NearestNeighbors
    nn = NearestNeighbors(n_neighbors=15, metric='cosine', n_jobs=-1)
    nn.fit(shap_normed)
    knn_dist = nn.kneighbors_graph(mode='distance')

    # Symmetrize kNN graph: for each edge, keep the minimum distance
    knn_sym = knn_dist.maximum(knn_dist.T)

    knn_distances = knn_sym.data[knn_sym.data > 0]
    median_knn = np.median(knn_distances)
    p25_knn = np.percentile(knn_distances, 25)

    if verbose:
        print(f"  SHAP kNN graph: {knn_sym.nnz} edges")
        print(f"  kNN distance stats: p25={p25_knn:.4f}, median={median_knn:.4f}")

    # --- Step 2: Build adjacency distance matrix ---
    # Adjacent points get a distance at the 25th percentile of kNN distances,
    # ensuring they're treated as "close" in the combined graph
    adj_distance = p25_knn

    if verbose:
        print(f"  Step 2: Building adjacency distance matrix (d={adj_distance:.4f})...", flush=True)

    from scipy.sparse import lil_matrix
    adj_sparse = lil_matrix((N, N), dtype=np.float64)
    n_adj_added = 0
    for i, neighbors in adjacency.items():
        for j in neighbors:
            adj_sparse[i, j] = adj_distance
            n_adj_added += 1

    if verbose:
        print(f"  Adjacency edges: {n_adj_added}")

    # --- Step 3: Merge graphs ---
    if verbose:
        print(f"  Step 3: Merging kNN + adjacency graphs...", flush=True)

    combined = knn_sym.tolil()
    adj_coo = adj_sparse.tocoo()
    new_edges = 0
    updated_edges = 0
    for i, j, d in zip(adj_coo.row, adj_coo.col, adj_coo.data):
        current = combined[i, j]
        if current == 0:
            combined[i, j] = d
            new_edges += 1
        elif d < current:
            combined[i, j] = d
            updated_edges += 1

    combined_csr = combined.tocsr()

    combined_csr = combined_csr.astype(np.float64)

    # Replace exact-zero distances with small epsilon FIRST
    # (identical SHAP profiles have cosine distance = 0, which sparse matrix drops)
    combined_csr.data[combined_csr.data == 0] = 1e-7

    # THEN zero the diagonal (UMAP requires self-distances = 0)
    combined_csr.setdiag(0)
    combined_csr.eliminate_zeros()

    # Determine min edges per row for n_neighbors
    row_counts = np.diff(combined_csr.indptr)
    min_row = int(row_counts.min())

    if verbose:
        print(f"  Combined graph: {combined_csr.nnz} edges "
              f"(+{new_edges} new, {updated_edges} updated from adjacency)")
        print(f"  Min/median/max edges per row: {min_row}/{int(np.median(row_counts))}/{int(row_counts.max())}")

    # --- Step 4: UMAP with precomputed distances ---
    n_nbrs = min(15, max(2, min_row))

    if verbose:
        print(f"  Step 4: Running UMAP to 3D (n_neighbors={n_nbrs})...", flush=True)

    import umap
    reducer = umap.UMAP(
        n_components=3,
        n_neighbors=n_nbrs,
        metric='precomputed',
        random_state=42,
        verbose=verbose,
    )
    embedding_3d = reducer.fit_transform(combined_csr)

    if verbose:
        print(f"  UMAP done in {time.time() - t0:.1f}s")
        print(f"  Raw 3D range: x=[{embedding_3d[:,0].min():.2f},{embedding_3d[:,0].max():.2f}] "
              f"y=[{embedding_3d[:,1].min():.2f},{embedding_3d[:,1].max():.2f}] "
              f"z=[{embedding_3d[:,2].min():.2f},{embedding_3d[:,2].max():.2f}]")

    # --- Step 5: Center at origin + project to unit sphere ---
    centroid = embedding_3d.mean(axis=0)
    embedding_centered = embedding_3d - centroid

    if verbose:
        print(f"  Centered at origin (shift: {centroid})")

    norms = np.linalg.norm(embedding_centered, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-8)
    sphere_xyz = (embedding_centered / norms).astype(np.float32)

    if verbose:
        print(f"  Embedding done in {time.time() - t0:.1f}s")

    return sphere_xyz


def xyz_to_spherical(xyz):
    """Convert unit sphere Cartesian (x,y,z) to spherical (theta, phi).
    theta: polar angle from +z axis, [0, pi]
    phi: azimuthal angle from +x axis, [0, 2*pi)
    """
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    theta = np.arccos(np.clip(z, -1.0, 1.0))
    phi = np.arctan2(y, x)
    phi = np.where(phi < 0, phi + 2 * np.pi, phi)
    return np.column_stack([theta, phi]).astype(np.float32)


def main():
    start = time.time()
    print("=" * 60)
    print("PerceptionSphere Embedding")
    print("=" * 60)

    # Load metadata
    print("\nLoading point metadata...")
    with open(SPHERE_DIR / "point_metadata.json") as f:
        metadata = json.load(f)
    N = len(metadata)
    print(f"  Points: {N}")

    # Load concatenated SHAP profiles
    print("Loading SHAP profiles...")
    shap_arrays = []
    for dim in PERCEPTION_DIMS:
        path = SHAP_DIR / f"{dim}.npy"
        if not path.exists():
            print(f"  ERROR: {path} not found")
            sys.exit(1)
        shap_arrays.append(np.load(path))
    shap_concatenated = np.concatenate(shap_arrays, axis=1)
    print(f"  Concatenated SHAP: {shap_concatenated.shape}")

    # Phase A: Build adjacency graph
    adjacency, adj_list = build_adjacency_graph(metadata)

    # Save adjacency
    adj_path = SPHERE_DIR / "adjacency_graph.json"
    with open(adj_path, "w") as f:
        json.dump(adj_list, f)
    print(f"  Saved: {adj_path.name} ({adj_path.stat().st_size / 1e6:.1f} MB)")

    # Phase B: UMAP + topological regularization
    sphere_xyz = run_umap_embedding(shap_concatenated, adjacency, N)

    # Convert to spherical coordinates
    spherical = xyz_to_spherical(sphere_xyz)

    # Save
    xyz_path = SPHERE_DIR / "embedding_cartesian.npy"
    np.save(xyz_path, sphere_xyz)
    print(f"\n  Saved: {xyz_path.name} ({xyz_path.stat().st_size / 1e6:.1f} MB)")

    sph_path = SPHERE_DIR / "embedding.npy"
    np.save(sph_path, spherical)
    print(f"  Saved: {sph_path.name} ({sph_path.stat().st_size / 1e6:.1f} MB)")

    # Quick statistics
    theta = spherical[:, 0]
    phi = spherical[:, 1]
    print(f"\n  Embedding statistics:")
    print(f"    theta (polar):     [{theta.min():.4f}, {theta.max():.4f}] mean={theta.mean():.4f}")
    print(f"    phi (azimuthal):   [{phi.min():.4f}, {phi.max():.4f}] mean={phi.mean():.4f}")

    # Check neighbor preservation
    if adj_list:
        sample_size = min(1000, N)
        sample_indices = np.random.RandomState(42).choice(N, sample_size, replace=False)
        point_tree = cKDTree(sphere_xyz)

        preserved = 0
        total_checked = 0
        for i in sample_indices:
            neighbors = adjacency.get(i, set())
            if not neighbors:
                continue
            # Find K nearest on sphere
            k = min(10, N - 1)
            _, knn_indices = point_tree.query(sphere_xyz[i], k=k + 1)
            knn_set = set(knn_indices[1:].tolist())
            for n in neighbors:
                total_checked += 1
                if n in knn_set:
                    preserved += 1

        recall = preserved / max(total_checked, 1)
        print(f"\n  Topology preservation (sample of {sample_size} points):")
        print(f"    Adjacency recall@10: {recall:.4f} ({preserved}/{total_checked})")

    elapsed = time.time() - start
    print(f"\n{'=' * 60}")
    print(f"Done in {elapsed:.1f}s ({elapsed/60:.1f} min)")


if __name__ == "__main__":
    main()