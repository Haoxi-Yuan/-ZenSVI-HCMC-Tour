# PerceptionSphere 前端改进方案 v3.0：迈向具身感知模拟器

本方案旨在弥合当前实现（纯色块球、SVG 叠加层）与设计文档（由城市肌理拼成的星球、具身包裹感、神经突触丛）之间的鸿沟。核心目标是通过 **LOD 纹理图集** 和 **3D 神经元网络**，实现视觉上的极致沉浸与数据上的直觉映射。

---

## 1. 阶段一：球体静态态 (The Sphere at Rest) —— 城市星球的纹理化

**目标：** 让二十多万个面片不再是单调的色块，而是呈现出一种“远看是云图，近看是街道”的微缩景观感。

### 1.1 LOD 纹理图集 (LOD Texture Atlas)
*   **策略：** 在球外观察时，不加载高清原图，而是使用一张预生成的 **Mosaic Atlas (马赛克图集)**。
*   **实现：** 
    *   将 20 万张缩略图压缩为 32x32 像素，平铺在一张或几张 4096px 的大纹理中。
    *   在 `GeodesicLayer` 的 `InstancedMesh` 中增加 `aUVOffset` 属性，指向图集中的对应位置。
    *   **Shader 伪代码：**
    ```glsl
    // Vertex Shader
    attribute vec2 aUVOffset; // 每个 instance 在 Atlas 中的起点 [0,1]
    varying vec2 vUV;
    void main() {
        // uv 是单元面片的 0-1 坐标，ATLAS_SIZE 是图集内面片数量的倒数
        vUV = aUVOffset + uv * (1.0 / ATLAS_COLS); 
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }

    // Fragment Shader
    uniform sampler2D uAtlas;
    varying vec2 vUV;
    void main() {
        vec4 texColor = texture2D(uAtlas, vUV);
        // 混合感知评分的颜色，保持 30% 的色调映射以指示数据属性
        gl_FragColor = mix(texColor, vec4(instanceColor, 1.0), 0.3);
    }
    ```

### 1.2 动态氛围增强
*   **感知引力动画：** 根据评分在自转中产生微小的“起伏” (Radial Displacement)。
*   **呼吸辉光：** 高评分区域产生节奏缓慢的 `Bloom` 溢出。

---

## 2. 阶段二：驻足感知态 (Perception at a Standstill) —— 具身突触丛

**目标：** 将 2D 看板转变为 3D 空间内的神经感知场，让用户感到环境因子正从四面八方“涌向”大脑。

### 2.1 3D 突触网络 (3D Synapse Thicket)
*   **策略：** 将 D3-force 扩展至 3D 空间，将 `SynapseNetwork` 从 SVG 迁移至 Three.js 场景。
*   **空间布局：** 以 Avatar 的头顶（球面法线方向）为中心点，通过 `d3-force-3d` 计算因子节点位置。
*   **伪代码：**
    ```javascript
    // 在 WebWorker 中运行
    const simulation = d3.forceSimulation3D(nodes)
        .force('center', d3.forceCenter3D(0, 0.5, 0).strength(0.1)) // 悬浮在头顶上方
        .force('charge', d3.forceManyBody().strength(-20))
        .force('link', d3.forceLink(links).distance(d => 1 / d.shap_value)) // 影响越大越靠近
        .on('tick', () => {
            // 将坐标传回主线程更新 Three.js Mesh
            postMessage({ nodes, links });
        });
    ```

### 2.2 能量流连线 (Energy Flow Lines)
*   **视觉化：** 使用 `MeshLine` 或 `ShaderMaterial` 渲染连线。
*   **动态：** 根据 SHAP 值正负（红/绿），让粒子沿连线从因子节点流向小人。
*   **Shader 逻辑：**
    ```glsl
    // 连线 Shader 片段
    uniform float uTime;
    varying float vU; // 沿线段的归一化长度 [0,1]
    void main() {
        float pulse = step(0.9, fract(vU * 5.0 - uTime * 2.0)); // 产生流动的光点
        vec3 color = mix(uLineColor, vec3(1.0), pulse);
        gl_FragColor = vec4(color, uOpacity);
    }
    ```

---

## 3. 阶段三：行走感知态 (Walking) —— 视觉包裹与颤震

**目标：** 消除“纸片感”，实现 360° 环境包围。

### 3.1 邻近瓦片纹理映射 (Neighborhood Projection)
*   **策略：** 当 Avatar 站立时，不只是加载圆柱全景，而是将其邻近的 6 个 Hexagon 面片动态替换为该点的真实街景切片。
*   **效果：** 用户环顾四周时，脚下的地理面片本身就是可见的街道，实现“街道与球面的一体化”。

### 3.2 感知震颤 (Perception Shake)
*   **策略：** 当跨越感知鸿沟（如从绿地进入贫民窟，SHAP 值剧变）时，触发全局后处理特效。
*   **动效：** `Chromatic Aberration` (色差抖动) + `Fast Zoom Blur`，持续 300ms，模拟大脑受到环境突变带来的“认知冲击”。

---

## 4. 阶段五：绽放映射态 (Bloom to Map) —— 有机演变

**目标：** 将机械的位移变为“花瓣绽放”的艺术化过渡。

### 4.1 贝塞尔轨迹脱壳 (Bezier Unfurling)
*   **策略：** 面片从球面 (S²) 到地图 (R²) 的位移不走直线。
*   **轨迹设计：** 先沿法线弹出 (Detach) -> 在半空由于惯性旋转 (Unfurl) -> 最终平滑落降至地理坐标。
*   **实现：** 在 `BloomAnimator` 中使用自定义 Shader 对 `instanceMatrix` 进行顶点位移。

---

## 5. 技术演进路线

1.  **渲染底层优化：** 引入 `EffectComposer` 实现 `Bloom` 和 `SelectiveGlow`。
2.  **LOD 系统建立：** 建立 `Mosaic Texture Atlas` 管道，修改 `GeodesicLayer` 的材质。
3.  **3D 节点系统：** 开发 `Synapse3DComponent`，替换现有的 SVG `SynapseNetwork`。
4.  **具身交互调优：** 优化 Camera 的 `FirstPerson` 逻辑，增加走动时的摄像机微动（Head Bobbing）。

**审美导向：**
配色方案应严格遵循 `DIM_CONFIG` 的高级灰调，背景球体在驻足态下应适当调暗（Desaturate），使 **亮起的神经突触网络** 成为绝对的视觉焦点，强化“内省”与“感知”的叙事氛围。
