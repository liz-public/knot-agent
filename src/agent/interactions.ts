export interface ApprovalPort {
  request(input: {
    readonly toolName: string
    readonly arguments: Readonly<Record<string, unknown>>
  }): Promise<'allow' | 'deny'>
}

export interface AskPort {
  ask(input: {
    readonly question: string
    readonly choices?: readonly string[]
  }): Promise<{ readonly answer: string; readonly cancelled?: boolean }>
}
