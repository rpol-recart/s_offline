---
name: open3d-processing
description: "Open3D point cloud and mesh processing — I/O, filtering, registration, reconstruction, visualization"
---

# Open3D Processing Skill

## When to Use

When working with 3D data — point clouds, meshes, depth images, LiDAR data, 3D reconstruction, or spatial analysis.

## Point Cloud I/O

```python
import open3d as o3d
import numpy as np

# Read
pcd = o3d.io.read_point_cloud("cloud.ply")     # PLY, PCD, XYZ, PTS, LAS
pcd = o3d.io.read_point_cloud("cloud.pcd")

print(f"Points: {len(pcd.points)}")
print(f"Has colors: {pcd.has_colors()}")
print(f"Has normals: {pcd.has_normals()}")
print(f"Bounds: {pcd.get_min_bound()} → {pcd.get_max_bound()}")

# Create from numpy
points = np.random.rand(10000, 3)
pcd = o3d.geometry.PointCloud()
pcd.points = o3d.utility.Vector3dVector(points)
pcd.colors = o3d.utility.Vector3dVector(np.random.rand(10000, 3))

# Write
o3d.io.write_point_cloud("output.ply", pcd)
o3d.io.write_point_cloud("output.pcd", pcd, write_ascii=True)
```

## Preprocessing

```python
# Downsampling
pcd_down = pcd.voxel_down_sample(voxel_size=0.05)  # 5cm voxel grid
pcd_down = pcd.uniform_down_sample(every_k_points=5)
pcd_down = pcd.random_down_sample(sampling_ratio=0.1)

# Statistical outlier removal
pcd_clean, ind = pcd.remove_statistical_outlier(
    nb_neighbors=20,
    std_ratio=2.0,
)

# Radius outlier removal
pcd_clean, ind = pcd.remove_radius_outlier(
    nb_points=16,
    radius=0.05,
)

# Crop to bounding box
bbox = o3d.geometry.AxisAlignedBoundingBox(
    min_bound=np.array([-1, -1, 0]),
    max_bound=np.array([1, 1, 2]),
)
pcd_cropped = pcd.crop(bbox)

# Normal estimation
pcd.estimate_normals(
    search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.1, max_nn=30)
)
pcd.orient_normals_consistent_tangent_plane(k=15)
```

## Registration (Alignment)

```python
# ICP (Iterative Closest Point)
threshold = 0.05  # Max correspondence distance

# Point-to-point ICP
reg = o3d.pipelines.registration.registration_icp(
    source=pcd1,
    target=pcd2,
    max_correspondence_distance=threshold,
    estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPoint(),
    criteria=o3d.pipelines.registration.ICPConvergenceCriteria(max_iteration=200),
)

print(f"Fitness: {reg.fitness:.4f}")  # Overlap ratio
print(f"RMSE: {reg.inlier_rmse:.4f}")
transformation = reg.transformation  # 4x4 matrix

# Apply transformation
pcd1.transform(transformation)

# Point-to-plane ICP (better, needs normals)
reg = o3d.pipelines.registration.registration_icp(
    source=pcd1,
    target=pcd2,
    max_correspondence_distance=threshold,
    estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPlane(),
)

# Global registration (RANSAC — no initial alignment needed)
source_fpfh = o3d.pipelines.registration.compute_fpfh_feature(
    pcd1, o3d.geometry.KDTreeSearchParamHybrid(radius=0.25, max_nn=100)
)
target_fpfh = o3d.pipelines.registration.compute_fpfh_feature(
    pcd2, o3d.geometry.KDTreeSearchParamHybrid(radius=0.25, max_nn=100)
)

reg_ransac = o3d.pipelines.registration.registration_ransac_based_on_feature_matching(
    source=pcd1,
    target=pcd2,
    source_feature=source_fpfh,
    target_feature=target_fpfh,
    mutual_filter=True,
    max_correspondence_distance=0.05,
    estimation_method=o3d.pipelines.registration.TransformationEstimationPointToPoint(),
    ransac_n=3,
    checkers=[
        o3d.pipelines.registration.CorrespondenceCheckerBasedOnEdgeLength(0.9),
        o3d.pipelines.registration.CorrespondenceCheckerBasedOnDistance(0.05),
    ],
    criteria=o3d.pipelines.registration.RANSACConvergenceCriteria(100000, 0.999),
)
```

## Surface Reconstruction

```python
# Poisson reconstruction (needs normals)
mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
    pcd, depth=9, width=0, scale=1.1, linear_fit=False
)

# Remove low-density vertices (cleanup)
densities = np.asarray(densities)
density_threshold = np.quantile(densities, 0.01)
vertices_to_remove = densities < density_threshold
mesh.remove_vertices_by_mask(vertices_to_remove)

# Ball pivoting
radii = [0.005, 0.01, 0.02, 0.04]
mesh = o3d.geometry.TriangleMesh.create_from_point_cloud_ball_pivoting(
    pcd, o3d.utility.DoubleVector(radii)
)

# Alpha shapes
mesh = o3d.geometry.TriangleMesh.create_from_point_cloud_alpha_shape(pcd, alpha=0.03)

# Mesh cleanup
mesh.remove_degenerate_triangles()
mesh.remove_duplicated_triangles()
mesh.remove_duplicated_vertices()
mesh.remove_non_manifold_edges()
mesh.compute_vertex_normals()
```

## Mesh Operations

```python
# Read/Write
mesh = o3d.io.read_triangle_mesh("model.obj")  # OBJ, PLY, STL, OFF, GLB
o3d.io.write_triangle_mesh("output.ply", mesh)

# Simplification
mesh_simplified = mesh.simplify_quadric_decimation(target_number_of_triangles=10000)
mesh_simplified = mesh.simplify_vertex_clustering(voxel_size=0.01)

# Subdivision
mesh_sub = mesh.subdivide_midpoint(number_of_iterations=1)

# Smooth
mesh_smooth = mesh.filter_smooth_laplacian(number_of_iterations=10)

# Properties
print(f"Vertices: {len(mesh.vertices)}")
print(f"Triangles: {len(mesh.triangles)}")
print(f"Watertight: {mesh.is_watertight()}")
print(f"Self-intersecting: {mesh.is_self_intersecting()}")
```

## RGBD & Depth Images

```python
# Read RGBD
color = o3d.io.read_image("color.png")
depth = o3d.io.read_image("depth.png")
rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
    color, depth,
    depth_scale=1000.0,       # mm to meters
    depth_trunc=3.0,          # Max depth in meters
    convert_rgb_to_intensity=False,
)

# Camera intrinsics
intrinsic = o3d.camera.PinholeCameraIntrinsic(
    width=640, height=480,
    fx=525.0, fy=525.0,
    cx=319.5, cy=239.5,
)

# RGBD to point cloud
pcd = o3d.geometry.PointCloud.create_from_rgbd_image(rgbd, intrinsic)

# TSDF Volume Integration (multi-view reconstruction)
volume = o3d.pipelines.integration.ScalableTSDFVolume(
    voxel_length=0.005,
    sdf_trunc=0.04,
    color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8,
)

for i, (rgbd, pose) in enumerate(zip(rgbd_images, camera_poses)):
    volume.integrate(rgbd, intrinsic, np.linalg.inv(pose))

mesh = volume.extract_triangle_mesh()
mesh.compute_vertex_normals()
```

## Visualization

```python
# Quick display
o3d.visualization.draw_geometries([pcd])

# Multiple objects with colors
pcd1.paint_uniform_color([1, 0, 0])  # Red
pcd2.paint_uniform_color([0, 1, 0])  # Green
o3d.visualization.draw_geometries([pcd1, pcd2])

# Non-blocking / headless rendering
vis = o3d.visualization.Visualizer()
vis.create_window(visible=False)
vis.add_geometry(pcd)
vis.poll_events()
vis.update_renderer()
vis.capture_screen_image("screenshot.png")
vis.destroy_window()

# Coordinate frame
frame = o3d.geometry.TriangleMesh.create_coordinate_frame(size=0.5)
o3d.visualization.draw_geometries([pcd, frame])
```

## Common Pipelines

### LiDAR Ground Segmentation

```python
def segment_ground(pcd, distance_threshold=0.1, ransac_n=3, num_iterations=1000):
    plane_model, inliers = pcd.segment_plane(
        distance_threshold=distance_threshold,
        ransac_n=ransac_n,
        num_iterations=num_iterations,
    )
    ground = pcd.select_by_index(inliers)
    objects = pcd.select_by_index(inliers, invert=True)
    return ground, objects, plane_model
```

### Clustering (DBSCAN)

```python
labels = np.array(pcd.cluster_dbscan(eps=0.05, min_points=10))
n_clusters = labels.max() + 1
print(f"Clusters: {n_clusters}")

# Color by cluster
colors = plt.cm.tab20(labels / max(n_clusters, 1))[:, :3]
colors[labels < 0] = 0  # Noise = black
pcd.colors = o3d.utility.Vector3dVector(colors)
```

## Best Practices

1. **Downsample first** — `voxel_down_sample` before any heavy computation
2. **Check empty** — verify `len(pcd.points) > 0` before processing
3. **Estimate normals** — required for Poisson reconstruction, ICP plane-to-point
4. **Statistical outlier removal** — always clean noisy point clouds
5. **Use RANSAC for global, ICP for local** — coarse-to-fine registration
6. **Memory management** — large point clouds (>10M points) need downsampling
7. **Save intermediate results** — registration transforms, cleaned point clouds
8. **Coordinate systems** — document whether Z-up or Y-up convention is used
