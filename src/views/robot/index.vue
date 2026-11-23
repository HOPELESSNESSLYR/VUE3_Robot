<template>
  <div class="robot-page">
    <!-- 左侧控制面板 -->
    <el-card class="robot-sidebar" shadow="never">
      <template #header>
        <div class="robot-title">
          <el-icon><Cpu /></el-icon>
          <span>机器人状态监控</span>
        </div>
      </template>

      <!-- 连接状态 -->
      <div class="robot-stat">
        <div class="robot-stat__label">连接状态</div>
        <div class="robot-stat__value">
          <el-tag :type="connected ? 'success' : 'danger'" effect="dark" size="small" round>
            {{ connected ? '在线' : '离线' }}
          </el-tag>
          <el-tag v-if="loading" type="info" size="small" effect="plain" round>连接中</el-tag>
        </div>
        <el-button class="robot-link" link type="primary" size="small" @click="toggleChannel">
          {{ directConnect ? '切换为代理连接（/robot-api）' : '切换为直连控制服务' }}
        </el-button>
      </div>

      <!-- 电池电量 -->
      <div class="robot-stat">
        <div class="robot-stat__label">电池电量</div>
        <div class="robot-battery">
          <span class="robot-battery__num">{{ robotState.battery }}</span>
          <span class="robot-battery__unit">%</span>
        </div>
        <el-progress
          :percentage="robotState.battery"
          :stroke-width="10"
          :show-text="false"
          :color="batteryColor"
        />
      </div>

      <!-- 实时速度 -->
      <div class="robot-stat">
        <div class="robot-stat__label">实时速度 (m/s)</div>
        <div class="robot-speed">
          <span>X: {{ robotState.velocity.x.toFixed(2) }}</span>
          <span>Z: {{ robotState.velocity.z.toFixed(2) }}</span>
        </div>
        <div class="robot-speed robot-speed--sub">
          <span>角速度: {{ robotState.yaw.toFixed(2) }}</span>
          <span>状态: {{ robotState.status }}</span>
        </div>
      </div>

      <!-- 关节角度 -->
      <div class="robot-stat">
        <div class="robot-stat__label">关节角度 (°)</div>
        <div class="robot-joints">
          <span v-for="(angle, index) in robotState.joint_angles" :key="index" class="robot-joints__item">
            J{{ index + 1 }}: {{ angle.toFixed(1) }}
          </span>
        </div>
      </div>

      <!-- 远程操控 -->
      <div class="robot-control">
        <div class="robot-stat__label">远程操控</div>
        <el-button
          class="robot-btn"
          type="primary"
          :loading="sending === 'move_forward'"
          @click="sendCommand('move_forward')"
        >
          <el-icon><Top /></el-icon>
          <span>前进</span>
        </el-button>
        <el-button
          class="robot-btn"
          type="primary"
          :loading="sending === 'move_backward'"
          @click="sendCommand('move_backward')"
        >
          <el-icon><Bottom /></el-icon>
          <span>后退</span>
        </el-button>
        <el-button
          class="robot-btn"
          type="primary"
          :loading="sending === 'turn_left'"
          @click="sendCommand('turn_left')"
        >
          <el-icon><Back /></el-icon>
          <span>左转</span>
        </el-button>
        <el-button
          class="robot-btn"
          type="primary"
          :loading="sending === 'turn_right'"
          @click="sendCommand('turn_right')"
        >
          <el-icon><Right /></el-icon>
          <span>右转</span>
        </el-button>
        <el-button
          class="robot-btn"
          type="danger"
          :loading="sending === 'emergency_stop'"
          @click="sendCommand('emergency_stop')"
        >
          <el-icon><VideoPause /></el-icon>
          <span>急停</span>
        </el-button>
      </div>

      <!-- 操作日志 -->
      <div class="robot-log">
        <div class="robot-log__head">
          <span class="robot-stat__label">操作日志</span>
          <el-button link type="primary" size="small" @click="logs = []">清空</el-button>
        </div>
        <div class="robot-log__list">
          <div v-for="item in logs" :key="item.id" :class="['robot-log__item', `is-${item.type}`]">
            <span class="robot-log__time">{{ item.time }}</span>
            <span class="robot-log__text">{{ item.text }}</span>
          </div>
          <div v-if="!logs.length" class="robot-log__empty">暂无日志</div>
        </div>
      </div>
    </el-card>

    <!-- 右侧 3D 视口 -->
    <div class="robot-viewport" ref="threeContainer">
      <div class="robot-viewport__toolbar">
        <el-button link size="small" @click="resetView">
          <el-icon><Refresh /></el-icon>
          <span>重置视角</span>
        </el-button>
        <span class="robot-viewport__tip">按住拖拽旋转 · 滚轮缩放</span>
      </div>
      <div v-if="threeError" class="robot-viewport__mask">{{ threeError }}</div>
    </div>
  </div>
</template>

<script setup name="Robot">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { disposeObject3D, loadThree } from '@/utils/robotThree'
import { createRobotState, normalizeRobotState } from '@/utils/robot'
import { getRobotStateWsUrl, robotCommand } from '@/api/robot'

/* ------------------------------ 状态定义 ------------------------------ */
const connected = ref(false)
const loading = ref(true)
const sending = ref('')
const robotState = reactive(createRobotState())
const logs = ref([])
const threeContainer = ref(null)
const threeError = ref('')

/** true 表示直连控制服务地址，false 表示走 vite / nginx 代理地址 */
const directConnect = ref(true)
const wsUrl = computed(() => getRobotStateWsUrl(directConnect.value))

const batteryColor = computed(() => {
  if (robotState.battery <= 20) return '#f56c6c'
  if (robotState.battery <= 50) return '#e6a23c'
  return '#67c23a'
})

let logId = 0
/** 日志最多保留条数 */
const LOG_LIMIT = 60
/** 断线重连间隔（毫秒） */
const RECONNECT_DELAY = 5000
/** 模型位移视觉缩放系数与边界（米） */
const MOTION_SCALE = 2
const MOTION_LIMIT = 9

let ws = null
let reconnectTimer = null
/** 用户主动断开时不再自动重连 */
let manualClose = false
/** 连续连接失败次数 */
let failCount = 0
let disposed = false

/* ------------------------------ 日志记录 ------------------------------ */
function addLog(text, type = 'info') {
  const now = new Date()
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(v => String(v).padStart(2, '0'))
    .join(':')
  logs.value.unshift({ id: ++logId, time, text, type })
  if (logs.value.length > LOG_LIMIT) {
    logs.value.splice(LOG_LIMIT)
  }
}

/* ------------------------------ 3D 场景 ------------------------------ */
let THREE = null
let scene = null
let camera = null
let renderer = null
let animationId = 0
let resizeObserver = null
/** 机器人模型：基座 / 云台 / 机械臂 */
let robotBase = null
let robotHead = null
let robotArm = null

/** 相机球坐标参数，用于拖动旋转、滚轮缩放与重置视角 */
const viewState = { distance: 7, theta: Math.PI * 0.75, phi: Math.PI * 0.34 }
const viewTarget = { x: 1.5, y: 0.5, z: 1.5 }
let dragStart = null

/** 初始化 Three.js 场景 */
async function initThree() {
  if (!threeContainer.value) return
  try {
    THREE = await loadThree()
  } catch (e) {
    threeError.value = '3D 依赖 three 加载失败，请在项目根6目录执行 pnpm install 后刷新页面'
    addLog('3D 依赖 three 加载失败', 'error')
    return
  }
  if (disposed) return

  try {
    scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)

    // 网格地面
    scene.add(new THREE.GridHelper(20, 20, 0x444444, 0x222222))

    // 灯光
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(5, 10, 7)
    scene.add(directionalLight)
    scene.add(new THREE.AmbientLight(0x404040))

    const width = threeContainer.value.clientWidth || 800
    const height = threeContainer.value.clientHeight || 600

    camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000)
    updateCamera()

    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setSize(width, height)
    threeContainer.value.appendChild(renderer.domElement)

    buildRobot()

    resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(threeContainer.value)

    animate()
    addLog('3D 场景初始化完成')
  } catch (e) {
    threeError.value = '3D 场景初始化失败，请检查浏览器 WebGL 支持'
    console.error('[robot] initThree failed', e)
  }
}

/** 构建简易机器人模型：立方体基座 + 圆柱云台 + 机械臂 */
function buildRobot() {
  const baseGeometry = new THREE.BoxGeometry(1, 0.5, 1)
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
  robotBase = new THREE.Mesh(baseGeometry, baseMaterial)
  robotBase.position.y = 0.25

  const headGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.6, 16)
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0x60a5fa })
  robotHead = new THREE.Mesh(headGeometry, headMaterial)
  robotHead.position.set(robotBase.position.x, 0.8, robotBase.position.z)

  const armGeometry = new THREE.BoxGeometry(0.15, 0.8, 0.15)
  const armMaterial = new THREE.MeshStandardMaterial({ color: 0x93c5fd })
  robotArm = new THREE.Mesh(armGeometry, armMaterial)
  robotArm.position.set(robotBase.position.x + 0.4, 0.9, robotBase.position.z)

  scene.add(robotBase, robotHead, robotArm)
}

/** 依据球坐标更新相机位置 */
function updateCamera() {
  if (!camera) return
  const { distance, theta, phi } = viewState
  camera.position.set(
    viewTarget.x + distance * Math.sin(phi) * Math.cos(theta),
    viewTarget.y + distance * Math.cos(phi),
    viewTarget.z + distance * Math.sin(phi) * Math.sin(theta)
  )
  camera.lookAt(viewTarget.x, viewTarget.y, viewTarget.z)
}

/** 重置 3D 视角 */
function resetView() {
  if (!camera) return
  viewState.distance = 7
  viewState.theta = Math.PI * 0.75
  viewState.phi = Math.PI * 0.34
  updateCamera()
  addLog('已重置 3D 视角')
}

/** 视口尺寸变化时同步相机与渲染器 */
function handleResize() {
  if (!camera || !renderer || !threeContainer.value) return
  const width = threeContainer.value.clientWidth
  const height = threeContainer.value.clientHeight
  if (!width || !height) return
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

/* ------------------------------ 鼠标交互 ------------------------------ */
function handlePointerDown(event) {
  if (!camera) return
  dragStart = { x: event.clientX, y: event.clientY, theta: viewState.theta, phi: viewState.phi }
  if (threeContainer.value.setPointerCapture) {
    threeContainer.value.setPointerCapture(event.pointerId)
  }
}

function handlePointerMove(event) {
  if (!dragStart) return
  viewState.theta = dragStart.theta - (event.clientX - dragStart.x) * 0.01
  viewState.phi = Math.min(Math.PI * 0.49, Math.max(0.08, dragStart.phi - (event.clientY - dragStart.y) * 0.01))
  updateCamera()
}

function handlePointerUp() {
  dragStart = null
}

function handleWheel(event) {
  if (!camera) return
  event.preventDefault()
  viewState.distance = Math.min(30, Math.max(3, viewState.distance + event.deltaY * 0.01))
  updateCamera()
}

/* ------------------------------ 渲染循环 ------------------------------ */
function animate() {
  animationId = requestAnimationFrame(animate)
  if (!renderer || !scene || !camera) return

  if (robotBase) {
    const { x, z } = robotState.velocity
    // 依据速度平移与转向，依据角速度调整朝向
    robotBase.rotation.y -= robotState.yaw * 0.02
    robotBase.position.x = Math.min(MOTION_LIMIT, Math.max(-MOTION_LIMIT, robotBase.position.x + z * 0.01 * MOTION_SCALE))
    robotBase.position.z = Math.min(MOTION_LIMIT, Math.max(-MOTION_LIMIT, robotBase.position.z + x * 0.01 * MOTION_SCALE))

    // 云台与机械臂跟随基座，机械臂依据首个关节角度摆动
    robotHead.position.set(robotBase.position.x, robotHead.position.y, robotBase.position.z)
    robotArm.position.set(robotBase.position.x + 0.4, robotArm.position.y, robotBase.position.z)
    robotArm.rotation.x = ((robotState.joint_angles[0] || 0) * Math.PI) / 180
  }

  renderer.render(scene, camera)
}

/* ------------------------------ WebSocket ------------------------------ */
function connectWS() {
  clearTimeout(reconnectTimer)
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  manualClose = false
  loading.value = true
  try {
    ws = new WebSocket(wsUrl.value)
  } catch (e) {
    loading.value = false
    addLog(`状态通道建立失败：${e.message}`, 'error')
    scheduleReconnect()
    return
  }

  ws.onopen = () => {
    connected.value = true
    loading.value = false
    failCount = 0
    addLog(`已连接状态通道（${wsUrl.value}）`, 'success')
  }

  ws.onmessage = event => {
    try {
      Object.assign(robotState, normalizeRobotState(JSON.parse(event.data)))
      connected.value = true
    } catch (e) {
      addLog('状态报文解析失败', 'error')
    }
  }

  ws.onerror = () => {
    loading.value = false
  }

  ws.onclose = () => {
    connected.value = false
    loading.value = false
    failCount += 1
    if (failCount === 1) {
      addLog(`状态通道已断开（${wsUrl.value}）`, 'error')
    }
    scheduleReconnect()
  }
}

/** 断开后按固定间隔自动重连 */
function scheduleReconnect() {
  if (manualClose || disposed) return
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(connectWS, RECONNECT_DELAY)
}

/** 断开连接（主动断开不再自动重连） */
function disconnectWS() {
  manualClose = true
  clearTimeout(reconnectTimer)
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
  connected.value = false
  loading.value = false
}

/** 在直连与代理两种连接方式之间切换 */
function toggleChannel() {
  directConnect.value = !directConnect.value
}

/* ------------------------------ 指令下发 ------------------------------ */
async function sendCommand(action) {
  sending.value = action
  try {
    await robotCommand(action)
    addLog(`指令已下发：${action}`, 'success')
    ElMessage.success(`指令已下发：${action}`)
  } catch (e) {
    addLog(`指令下发失败：${action}（${e.message}）`, 'error')
    ElMessage.error(`指令下发失败：${action}`)
  } finally {
    sending.value = ''
  }
}

/* ------------------------------ 生命周期 ------------------------------ */
watch(wsUrl, () => {
  disconnectWS()
  connectWS()
})

onMounted(() => {
  initThree()

  const el = threeContainer.value
  if (el) {
    el.addEventListener('pointerdown', handlePointerDown)
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerup', handlePointerUp)
    el.addEventListener('pointercancel', handlePointerUp)
    el.addEventListener('pointerleave', handlePointerUp)
    el.addEventListener('wheel', handleWheel, { passive: false })
  }

  connectWS()
  addLog('机器人控制台已启动')
})

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(reconnectTimer)
  disconnectWS()

  const el = threeContainer.value
  if (el) {
    el.removeEventListener('pointerdown', handlePointerDown)
    el.removeEventListener('pointermove', handlePointerMove)
    el.removeEventListener('pointerup', handlePointerUp)
    el.removeEventListener('pointercancel', handlePointerUp)
    el.removeEventListener('pointerleave', handlePointerUp)
    el.removeEventListener('wheel', handleWheel)
  }

  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  cancelAnimationFrame(animationId)
  if (renderer) {
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
    renderer.dispose()
    renderer = null
  }
  if (scene) {
    disposeObject3D(scene)
    scene = null
  }
  robotBase = robotHead = robotArm = null
  camera = null
})
</script>

<style scoped>
/* 页面整体：左侧控制面板 + 右侧 3D 视口 */
.robot-page {
  display: flex;
  gap: 16px;
  height: calc(100vh - 148px);
  min-height: 520px;
}

/* ------------------------------ 左侧面板 ------------------------------ */
.robot-sidebar {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.robot-sidebar :deep(.el-card__body) {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.robot-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 16px;
  color: var(--el-color-primary);
}

.robot-stat {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.robot-stat__label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.robot-stat__value {
  display: flex;
  align-items: center;
  gap: 8px;
}

.robot-battery {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 8px;
}

.robot-battery__num {
  font-size: 26px;
  font-weight: 600;
  font-family: Consolas, Monaco, monospace;
}

.robot-battery__unit {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.robot-speed {
  display: flex;
  justify-content: space-between;
  font-family: Consolas, Monaco, monospace;
  font-size: 14px;
}

.robot-speed--sub {
  margin-top: 6px;
  font-size: 12px;
  font-family: inherit;
  color: var(--el-text-color-secondary);
}

.robot-joints {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.robot-joints__item {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  background: var(--el-fill-color);
  border-radius: 4px;
  padding: 2px 6px;
}

.robot-link {
  margin-top: 8px;
  padding: 0;
}

/* ------------------------------ 控制按钮 ------------------------------ */
.robot-control {
  margin: 16px 0;
}

.robot-btn {
  width: 100%;
  margin: 0 0 8px 0;
  justify-content: flex-start;
}

.robot-btn :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* ------------------------------ 日志 ------------------------------ */
.robot-log__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.robot-log__list {
  max-height: 150px;
  overflow-y: auto;
  font-size: 12px;
}

.robot-log__item {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  line-height: 1.6;
}

.robot-log__time {
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}

.robot-log__text {
  word-break: break-all;
}

.robot-log__item.is-success .robot-log__text {
  color: var(--el-color-success);
}

.robot-log__item.is-error .robot-log__text {
  color: var(--el-color-danger);
}

.robot-log__empty {
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: 8px 0;
}

/* ------------------------------ 3D 视口 ------------------------------ */
.robot-viewport {
  position: relative;
  flex: 1;
  min-width: 0;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1a1a;
  border: 1px solid var(--el-border-color);
  cursor: grab;
  touch-action: none;
}

.robot-viewport:active {
  cursor: grabbing;
}

.robot-viewport__toolbar {
  position: absolute;
  top: 8px;
  left: 12px;
  right: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.75);
}

.robot-viewport__toolbar :deep(.el-button) {
  color: rgba(255, 255, 255, 0.85);
}

.robot-viewport__tip {
  font-size: 12px;
}

.robot-viewport__mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
  background: rgba(0, 0, 0, 0.35);
}

/* 窄屏时上下排列，保证 3D 视口可用 */
@media (max-width: 992px) {
  .robot-page {
    flex-direction: column;
    height: auto;
  }

  .robot-sidebar {
    width: 100%;
  }

  .robot-viewport {
    height: 60vh;
    min-height: 360px;
  }
}
</style>
