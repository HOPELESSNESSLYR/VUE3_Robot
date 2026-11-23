/**
 * Three.js 加载器
 *
 * 本项目通过 npm 依赖 three 引入（见 package.json 的 dependencies）。
 * 当依赖尚未安装（本地未执行 pnpm install）时，自动回退到 CDN 版本，
 * 保证页面仍可正常渲染 3D 视口，仅提示用户安装依赖。
 */

/** 与 package.json 中 three 的版本保持一致 */
const THREE_VERSION = '0.170.0'

let loadPromise = null

/**
 * 加载 Three.js 模块
 * @returns {Promise<object>} THREE 命名空间
 */
export function loadThree() {
  if (!loadPromise) {
    loadPromise = import('three')
      .then(module => validateThree(module))
      .catch(() => loadThreeFromCdn())
  }
  return loadPromise
}

/** 校验模块是否可用，避免拿到无效模块后静默出错 */
function validateThree(module) {
  const THREE = module && module.Scene ? module : module && module.default
  if (!THREE || !THREE.Scene || !THREE.WebGLRenderer) {
    throw new Error('three 模块不可用')
  }
  return THREE
}

/** 依赖缺失时的 CDN 回退方案 */
function loadThreeFromCdn() {
  if (window.THREE && window.THREE.Scene) {
    return Promise.resolve(window.THREE)
  }
  return import(/* @vite-ignore */ `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`)
    .then(module => validateThree(module))
    .catch(() => {
      throw new Error('three 加载失败，请执行 pnpm install 安装依赖')
    })
}

/**
 * 释放 Object3D 树上的几何体与材质，避免 WebGL 资源泄漏
 * @param {object} object 需要释放的对象
 */
export function disposeObject3D(object) {
  if (!object || !object.traverse) return
  object.traverse(item => {
    if (item.geometry && typeof item.geometry.dispose === 'function') {
      item.geometry.dispose()
    }
    const materials = Array.isArray(item.material) ? item.material : item.material ? [item.material] : []
    materials.forEach(material => {
      Object.keys(material).forEach(key => {
        const value = material[key]
        if (value && value.isTexture && typeof value.dispose === 'function') {
          value.dispose()
        }
      })
      if (typeof material.dispose === 'function') {
        material.dispose()
      }
    })
  })
}
