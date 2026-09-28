import { createAdbAppIndex } from './adb/app-index.js'
import { createAdbDispatcher } from './adb/dispatcher.js'
import { createAdbExecutor } from './adb/executor.js'
import { readMapApiConfig } from './adb/map-config.js'
import { createAdbDeviceSession } from './adb/session.js'
import type { AskPort } from './ask-port.js'
import type { ApprovalPort } from './approval-port.js'
import { createStaticAppMatcher, type AppMatcher } from './context-contributions.js'
import {
  withApprovalPolicy,
  type ApprovalPolicy,
  type ToolDispatcher,
} from './dispatcher.js'
import { createMockAndroidDispatcher } from './mock-android-tools.js'
import { createAndroidDeviceSession } from './tools.js'

export interface Case1ToolRuntime {
  readonly dispatcher: ToolDispatcher
  readonly appMatcher?: AppMatcher
}

const CASE1_APPROVAL_POLICY: ApprovalPolicy = request => {
  if (request.toolId === 'contact_delete') {
    return { toolName: 'contact.delete', arguments: request.arguments }
  }
  if (request.toolId === 'contact' && request.arguments['sub'] === 'call') {
    return { toolName: 'contact.call', arguments: request.arguments }
  }
  return undefined
}

export function applyCase1ApprovalPolicy(
  dispatcher: ToolDispatcher,
  approvalPort?: ApprovalPort,
): ToolDispatcher {
  return withApprovalPolicy(dispatcher, approvalPort, CASE1_APPROVAL_POLICY)
}

export function createMockCase1ToolRuntime(options: {
  readonly askPort?: AskPort
  readonly approvalPort?: ApprovalPort
} = {}): Case1ToolRuntime {
  return {
    dispatcher: applyCase1ApprovalPolicy(
      createMockAndroidDispatcher(createAndroidDeviceSession(), options),
      options.approvalPort,
    ),
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
    dispatcher: applyCase1ApprovalPolicy(createAdbDispatcher(executor, createAdbDeviceSession(), {
      appIndex,
      askPort: options.askPort,
      mapApi: readMapApiConfig(),
    }), options.approvalPort),
    appMatcher: appIndex,
  }
}
