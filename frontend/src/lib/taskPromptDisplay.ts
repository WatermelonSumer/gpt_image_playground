import type { TaskRecord } from '../types'

export function isAgentTaskPromptPending(_task: TaskRecord): boolean {
  // Agent 模式已永久删除，此函数保留以兼容调用方，始终返回 false
  return false
}
