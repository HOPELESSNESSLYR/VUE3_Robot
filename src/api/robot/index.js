/**
 * 具身智能机器人控制台 通讯接口
 *
 * 说明：机器人控制服务与若依后端（VITE_APP_BASE_API）通常不是同一个服务，地址集中在此处配置。
 *   - 开发环境：默认使用相对地址 /robot-api，由 vite 代理转发（见 vite.config.js 的 /robot-api 代理，已开启 ws），避免跨域问题
 *   - 生产环境：可将 .env.production 中的 VITE_APP_ROBOT_CONTROL_URL 配置为真实地址（如 http://192.168.1.10:8000）
 *     或配置为同源前缀（如 /robot-api），由 Nginx 反向代理到控制服务
 */

/** 未配置时的相对代理前缀（开发环境由 vite 代理） */
const PROXY_PREFIX = '/robot-api'

/** 读取环境变量中配置的控制服务地址（去掉末尾斜杠） */
const controlUrl = (import.meta.env.VITE_APP_ROBOT_CONTROL_URL || '').replace(/\/+$/, '')

/**
 * 机器人状态推送地址（WebSocket）
 * @param {boolean} direct 是否直连控制服务，false 时走同源代理路径
 * @returns {string} WebSocket 地址，如 ws://localhost/robot-api/ws/robot-state
 */
export function getRobotStateWsUrl(direct = true) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  if (!direct || !controlUrl) {
    // 同源代理地址：协议与当前页面保持一致，交给 vite / nginx 转发
    return `${protocol}//${window.location.host}${PROXY_PREFIX}/ws/robot-state`
  }
  return `${controlUrl.replace(/^http/, 'ws')}/ws/robot-state`
}

/**
 * 机器人控制指令地址
 * @returns {string} HTTP 地址
 */
export function getRobotCommandUrl() {
  return `${controlUrl || PROXY_PREFIX}/api/command`
}

/**
 * 下发机器人控制指令
 * @param {string} action 指令动作，如 move_forward / turn_left / emergency_stop
 * @returns {Promise<object>} 控制服务返回的数据
 */
export function robotCommand(action) {
  return fetch(getRobotCommandUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, timestamp: Date.now() })
  }).then(res => {
    if (!res.ok) {
      throw new Error(`控制服务响应异常(${res.status})`)
    }
    return res.json().catch(() => ({}))
  })
}
