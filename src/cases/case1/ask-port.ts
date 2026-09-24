export interface AskPort {
  ask(input: {
    readonly question: string
    readonly choices?: readonly string[]
  }): Promise<{ readonly answer: string }>
}
