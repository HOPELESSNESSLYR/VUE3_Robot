/**
 * 机器人状态数据解析工具
 *
 * 兼容多种状态报文格式，避免后端字段调整导致控制台报错：
 *   1. { battery, velocity: { x, z }, joint_angles, status }
 *   2. { battery, linear: { x, y, z }, angular: { x, y, z }, joint_angles }  // ROS 风格
 *   3. { battery, speed, direction }                                        // 精简风格
 */

/** 创建一份默认的机器人状态 */
export function createRobotState() {
  return {
    battery: 0,
    status: 'offline',
    joint_angles: [0, 0, 0, 0, 0, 0],
    velocity: { x: 0, z: 0 },
    yaw: 0
  }
}

/** 数值兜底，非法值统一回落为 0 */
function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

/** 限制数值区间 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * 将后端推送的原始报文解析为控制台内部统一的状态结构
 * @param {object} raw WebSocket 推送的原始数据
 * @returns {object} 归一化后的机器人状态
 */
export function normalizeRobotState(raw) {
  const state = createRobotState()
  if (!raw || typeof raw !== 'object') {
    return state
  }

  // 电量：兼容 battery / battery_level / power
  state.battery = Math.round(clamp(toNumber(raw.battery ?? raw.battery_level ?? raw.power), 0, 100))

  // 状态：兼容 status / state
  state.status = raw.status || raw.state || 'online'

  // 关节角度：兼容 joint_angles / joints / servo_angles
  const joints = raw.joint_angles || raw.joints || raw.servo_angles
  if (Array.isArray(joints)) {
    state.joint_angles = joints.map(item => toNumber(item))
  }

  // 线速度：兼容 velocity.x/z、linear.x、speed+direction
  let vx = toNumber(raw.velocity?.x ?? raw.linear?.x ?? raw.vx)
  let vz = toNumber(raw.velocity?.z ?? raw.linear?.z ?? raw.vz)
  if (raw.speed !== undefined) {
    const speed = toNumber(raw.speed)
    const direction = toNumber(raw.direction)
    vx = Math.sin(direction) * speed
    vz = Math.cos(direction) * speed
  }
  state.velocity = { x: vx, z: vz }

  // 角速度：兼容 angular.z / yaw_rate，用于更新模型朝向
  let angularZ = toNumber(raw.velocity?.yaw ?? raw.angular?.z ?? raw.yaw_rate)
  if (raw.speed !== undefined && raw.direction !== undefined) {
    angularZ = toNumber(raw.angular?.z ?? raw.yaw_rate)
  }
  state.yaw = angularZ

  return state
}

/**
 * 格式化机器人状态为日志文本
 * @param {object} state 归一化后的机器人状态
 */
export function formatRobotState(state) {
  return `电量 ${state.battery}% · X ${state.velocity.x.toFixed(2)} m/s · Z ${state.velocity.z.toFixed(2)} m/s`
}
