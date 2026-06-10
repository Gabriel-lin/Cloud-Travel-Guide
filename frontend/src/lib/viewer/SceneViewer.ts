import * as THREE from "three";

import {
  createDefaultModelLoaderRegistry,
  type ModelLoadOptions,
  type ModelLoadResult,
  type ModelLoaderRegistry,
  type ModelSource,
} from "../loaders";
import type { INavigationController } from "../navigation";

/** 可被每帧驱动的对象(导航控制器、瓦片提供者等均实现它)。 */
export interface SceneUpdatable {
  update(delta: number): void;
  /** 可选的资源释放。 */
  dispose?(): void;
}

/** 供瓦片/插件等使用的渲染上下文快照。 */
export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  domElement: HTMLCanvasElement;
}

/** SceneViewer 构造可选项。 */
export interface SceneViewerOptions {
  /** 挂载容器(渲染 canvas 会追加到其中)。 */
  container: HTMLElement;
  fov?: number;
  near?: number;
  far?: number;
  cameraPosition?: THREE.Vector3 | [number, number, number];
  /** 背景色;传 null 表示透明。默认深色。 */
  background?: THREE.ColorRepresentation | null;
  /** 是否添加默认三点光照。默认 true。 */
  addDefaultLights?: boolean;
  /** devicePixelRatio 上限。默认 2。 */
  pixelRatioCap?: number;
  /** 透传给 WebGLRenderer 的参数。 */
  rendererParameters?: THREE.WebGLRendererParameters;
  /** 注入自定义模型加载器注册中心;不传则按需创建默认实例。 */
  loaderRegistry?: ModelLoaderRegistry;
}

/**
 * 场景总装类(orchestrator)。
 *
 * 把 渲染器 / 场景 / 相机 / 光照 / 动画循环 / 自适应尺寸 / 模型加载 / 导航 与
 * 各类"可更新内容"(地形、3D Tiles 等)整合到一处,提供一致的生命周期与
 * 统一的 `add` / `addUpdatable` / `loadModel` / `start` / `dispose` 接口。
 *
 * 它本身与具体内容解耦:导航控制器、地形提供者、瓦片提供者都以
 * {@link SceneUpdatable} 的形式接入,因此既能跑本地高程地形,也能跑大范围实景三维。
 */
export class SceneViewer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly timer = new THREE.Timer();

  private readonly container: HTMLElement;
  private readonly pixelRatioCap: number;
  private readonly resizeObserver: ResizeObserver;
  private readonly updatables = new Set<SceneUpdatable>();
  private readonly preNavCallbacks = new Set<(delta: number) => void>();
  private readonly renderCallbacks = new Set<(delta: number) => void>();

  private injectedRegistry: ModelLoaderRegistry | null;
  private ownedRegistry: ModelLoaderRegistry | null = null;
  private navigationController: INavigationController | null = null;
  private rafId = 0;
  private running = false;
  private disposed = false;

  constructor(options: SceneViewerOptions) {
    this.container = options.container;
    this.pixelRatioCap = options.pixelRatioCap ?? 2;
    this.injectedRegistry = options.loaderRegistry ?? null;

    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);

    this.scene = new THREE.Scene();
    const background = options.background;
    this.scene.background =
      background === null
        ? null
        : new THREE.Color(background ?? 0x0b1220);

    this.camera = new THREE.PerspectiveCamera(
      options.fov ?? 55,
      width / height,
      options.near ?? 0.1,
      options.far ?? 5000,
    );
    const pos = options.cameraPosition ?? [0, 60, 140];
    if (Array.isArray(pos)) this.camera.position.set(pos[0], pos[1], pos[2]);
    else this.camera.position.copy(pos);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      ...options.rendererParameters,
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.pixelRatioCap),
    );
    this.renderer.setSize(width, height);
    this.container.appendChild(this.renderer.domElement);

    if (options.addDefaultLights !== false) this.addDefaultLights();

    // 借助 Page Visibility API,标签页切走时避免产生过大的时间增量。
    if (typeof document !== "undefined") this.timer.connect(document);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
  }

  /** 模型加载器注册中心(按需懒创建默认实例)。 */
  get loaders(): ModelLoaderRegistry {
    if (this.injectedRegistry) return this.injectedRegistry;
    if (!this.ownedRegistry) {
      this.ownedRegistry = createDefaultModelLoaderRegistry();
    }
    return this.ownedRegistry;
  }

  /** 当前导航控制器。 */
  get navigation(): INavigationController | null {
    return this.navigationController;
  }

  /** 渲染上下文快照(供瓦片/插件接入)。 */
  get context(): SceneContext {
    return {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      domElement: this.renderer.domElement,
    };
  }

  add(...objects: THREE.Object3D[]): this {
    this.scene.add(...objects);
    return this;
  }

  remove(...objects: THREE.Object3D[]): this {
    this.scene.remove(...objects);
    return this;
  }

  /** 注册每帧更新对象,返回解绑函数。 */
  addUpdatable(updatable: SceneUpdatable): () => void {
    this.updatables.add(updatable);
    return () => this.updatables.delete(updatable);
  }

  removeUpdatable(updatable: SceneUpdatable): void {
    this.updatables.delete(updatable);
  }

  /** 注册导航更新前回调(例如更新 Orbit 目标点)。 */
  addPreNavCallback(callback: (delta: number) => void): () => void {
    this.preNavCallbacks.add(callback);
    return () => this.preNavCallbacks.delete(callback);
  }

  /** 注册渲染前回调(在所有 updatable 之后、渲染之前执行)。 */
  addRenderCallback(callback: (delta: number) => void): () => void {
    this.renderCallbacks.add(callback);
    return () => this.renderCallbacks.delete(callback);
  }

  /** 设置导航控制器(替换旧的并自动纳入更新循环)。 */
  setNavigation<T extends INavigationController>(controller: T): T {
    if (this.navigationController) {
      this.removeUpdatable(this.navigationController);
    }
    this.navigationController = controller;
    this.addUpdatable(controller);
    return controller;
  }

  /** 通过注册中心加载模型;默认自动加入场景。 */
  async loadModel(
    source: ModelSource,
    options?: ModelLoadOptions,
    config: { add?: boolean } = {},
  ): Promise<ModelLoadResult> {
    const result = await this.loaders.load(source, options);
    if (config.add !== false) this.scene.add(result.object);
    return result;
  }

  /** 取景到目标(优先委托导航控制器)。 */
  frame(target: THREE.Object3D | THREE.Box3): void {
    if (this.navigationController) {
      this.navigationController.frame(target);
      return;
    }
    const box =
      target instanceof THREE.Box3
        ? target
        : new THREE.Box3().setFromObject(target);
    const center = box.getCenter(new THREE.Vector3());
    this.camera.lookAt(center);
  }

  /** 启动渲染循环。 */
  start(): this {
    if (this.running || this.disposed) return this;
    this.running = true;
    this.timer.update();
    this.tick();
    return this;
  }

  /** 暂停渲染循环。 */
  stop(): this {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    return this;
  }

  /** 立即渲染一帧(不进入循环)。 */
  renderOnce(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();

    for (const updatable of this.updatables) updatable.dispose?.();
    this.updatables.clear();
    this.preNavCallbacks.clear();
    this.renderCallbacks.clear();
    this.navigationController = null;

    this.ownedRegistry?.dispose();
    this.ownedRegistry = null;
    this.injectedRegistry = null;

    this.timer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private tick = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
    this.timer.update();
    const delta = this.timer.getDelta();
    for (const callback of this.preNavCallbacks) callback(delta);
    this.navigationController?.update(delta);
    for (const updatable of this.updatables) {
      if (updatable !== this.navigationController) {
        updatable.update(delta);
      }
    }
    for (const callback of this.renderCallbacks) callback(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private addDefaultLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    this.scene.add(new THREE.HemisphereLight(0xbfdfff, 0x382c20, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(60, 120, 40);
    this.scene.add(key);
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.pixelRatioCap),
    );
    this.renderer.setSize(width, height);
  }
}
