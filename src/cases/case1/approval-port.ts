export interface ApprovalPort {
  request(input: {
    readonly toolName: string
    readonly arguments: Readonly<Record<string, unknown>>
  }): Promise<'allow' | 'deny'>
}
