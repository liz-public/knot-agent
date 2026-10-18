/** Native capabilities, not model tool invocations or shell commands. */
export interface DevicePort {
  request(capability: string, arguments_: Record<string, unknown>,
    context: { readonly turnId: string; readonly callId?: string }): Promise<Record<string, unknown>>
}
