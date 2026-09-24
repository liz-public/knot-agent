import { createAdbAppIndex } from './adb/app-index.js'
import { createAdbDispatcher } from './adb/dispatcher.js'
import { createAdbExecutor } from './adb/executor.js'
import { createAdbDeviceSession } from './adb/session.js'
import type { AskPort } from './ask-port.js'
import type { ApprovalPort } from './approval-port.js'
import { createStaticAppMatcher, type AppMatcher } from './context-contributions.js'
import type { ToolDispatcher } from './dispatcher.js'
import { createMockAndroidDispatcher } from './mock-android-tools.js'
import { createAndroidDeviceSession } from './tools.js'

export interface Case1ToolRuntime {
  readonly dispatcher: ToolDispatcher
  readonly appMatcher?: AppMatcher
}

export function createMockCase1ToolRuntime(options: { readonly askPort?: AskPort } = {}): Case1ToolRuntime {
  return {
    dispatcher: createMockAndroidDispatcher(createAndroidDeviceSession(), options),
    appMatcher: createStaticAppMatcher({ 电话: 'com.samsung.android.dialer' }),
  }
}

export function createAdbCase1ToolRuntime(options: {
  readonly serial?: string
  readonly askPort?: AskPort
  readonly approvalPort?: ApprovalPort
} = {}): Case1ToolRuntime {
  const executor = createAdbExecutor({ serial: options.serial })
  const appIndex = createAdbAppIndex(executor)
  return {
    dispatcher: createAdbDispatcher(executor, createAdbDeviceSession(), {
      appIndex,
      askPort: options.askPort,
      approvalPort: options.approvalPort,
    }),
    appMatcher: appIndex,
  }
}
