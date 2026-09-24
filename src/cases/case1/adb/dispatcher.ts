import type { AskPort } from '../ask-port.js'
import type { ApprovalPort } from '../approval-port.js'
import { createToolDispatcher, type ToolDispatcher } from '../dispatcher.js'
import type { AppIndex } from './app-index.js'
import { appHandlers } from './commands/apps.js'
import { calendarHandlers } from './commands/calendar.js'
import { communicationHandlers } from './commands/communication.js'
import { screenHandlers } from './commands/screen.js'
import { systemHandlers } from './commands/system.js'
import { telecomHandlers } from './commands/telecom.js'
import type { AdbExecutor } from './executor.js'
import type { AdbDeviceSession } from './session.js'

export interface AdbDispatcherOptions {
  readonly askPort?: AskPort
  readonly approvalPort?: ApprovalPort
  readonly appIndex?: AppIndex
}

/** The only ADB-specific composition point. Catalog, parsing and Journal plugins stay common. */
export function createAdbDispatcher(
  executor: AdbExecutor,
  session: AdbDeviceSession,
  options: AdbDispatcherOptions = {},
): ToolDispatcher {
  return createToolDispatcher({
    ...telecomHandlers(executor, session, { approvalPort: options.approvalPort }),
    ...systemHandlers(executor),
    ...communicationHandlers(executor),
    ...appHandlers(executor, { askPort: options.askPort, appIndex: options.appIndex }),
    ...calendarHandlers(executor),
    ...screenHandlers(executor),
  })
}
