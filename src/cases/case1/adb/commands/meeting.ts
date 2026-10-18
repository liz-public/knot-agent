import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { openInstalledApp } from './app-link.js'
import { meetingTarget } from '../../app-links.js'

export function meetingHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async join_meeting(arguments_) {
      const target = meetingTarget(arguments_)
      if ('content' in target) return target
      return openInstalledApp(executor, target.uri, target.packageName, target.payload, target.hint)
    },
  }
}
