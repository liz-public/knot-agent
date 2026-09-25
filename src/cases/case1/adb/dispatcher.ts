import type { AskPort } from '../ask-port.js'
import type { ApprovalPort } from '../approval-port.js'
import { createToolDispatcher, type ToolDispatcher } from '../dispatcher.js'
import type { AppIndex } from './app-index.js'
import { appHandlers } from './commands/apps.js'
import { calendarHandlers } from './commands/calendar.js'
import { commerceHandlers } from './commands/commerce.js'
import { communicationHandlers } from './commands/communication.js'
import { discoveryHandlers } from './commands/discovery.js'
import { meetingHandlers } from './commands/meeting.js'
import { navigationHandlers } from './commands/navigation.js'
import { qrcodeHandlers } from './commands/qrcode.js'
import { screenHandlers } from './commands/screen.js'
import { selectionHandlers } from './commands/selection.js'
import { settingsHandlers } from './commands/settings.js'
import { systemHandlers } from './commands/system.js'
import { telecomHandlers } from './commands/telecom.js'
import { travelHandlers } from './commands/travel.js'
import { weatherHandlers } from './commands/weather.js'
import type { AdbExecutor } from './executor.js'
import type { MapApiConfig } from './map-config.js'
import type { AdbDeviceSession } from './session.js'

export interface AdbDispatcherOptions {
  readonly askPort?: AskPort
  readonly approvalPort?: ApprovalPort
  readonly appIndex?: AppIndex
  readonly mapApi?: MapApiConfig
}

/** The only ADB-specific composition point. Catalog, parsing and Journal plugins stay common. */
export function createAdbDispatcher(
  executor: AdbExecutor,
  session: AdbDeviceSession,
  options: AdbDispatcherOptions = {},
): ToolDispatcher {
  return createToolDispatcher({
    ...telecomHandlers(executor, session, { approvalPort: options.approvalPort }),
    ...navigationHandlers(executor, session, { mapApi: options.mapApi }),
    ...weatherHandlers(executor, { mapApi: options.mapApi }),
    ...selectionHandlers(executor, session),
    ...systemHandlers(executor),
    ...discoveryHandlers(executor),
    ...commerceHandlers(executor),
    ...meetingHandlers(executor),
    ...travelHandlers(executor),
    ...settingsHandlers(executor),
    ...qrcodeHandlers(executor),
    ...communicationHandlers(executor),
    ...appHandlers(executor, { askPort: options.askPort, appIndex: options.appIndex }),
    ...calendarHandlers(executor),
    ...screenHandlers(executor),
  })
}
