/** Native card inputs only. Raw Journal, Context and Trajectory are untouched. */
const aliases: Record<string, string> = { 'todo.write': 'todo_write', 'goal.write': 'update_goal', spawn_agent: 'subagent', ask: 'ask_user_question' }

export function nativeToolProps(props: any) {
  const { toolName: name, block } = props
  const toolName = aliases[name] ?? name
  if (!block || props.phase === 'preparing' || block.phase === 'preparing') return { ...props, toolName }
  const call = 'kind' in block ? block.call : block
  if (!call) return { ...props, toolName }
  let args: any, result: any
  try {
    args = JSON.parse(call.argsRaw)
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ...props, toolName }
  } catch { return { ...props, toolName } }
  if (block.content?.length === 1 && block.content[0].type === 'text') {
    try { result = JSON.parse(block.content[0].text) } catch { /* Plain output stays plain. */ }
  }
  let mapped = { ...args }, content = block.content, meta = block.meta, isError = block.isError
  if (['read', 'write', 'edit'].includes(name)) mapped.file_path = args.path
  if (name === 'edit') { mapped.old_string = args.oldText; mapped.new_string = args.newText }
  if (name === 'spawn_agent') mapped.prompt = args.task
  if (name === 'web_search') {
    if (typeof args.query === 'string' && args.query.trim()) mapped.queries = [args.query]
    if (result?.ok === true && Array.isArray(result.sources)) {
      // Knot's search tool forwards every returned source; it has no result cap.
      // This describes tool-side clipping, not upstream search completeness.
      meta = { sources: result.sources, truncated: false }
    }
  }
  if (name === 'ask') {
    mapped = { questions: [{ id: block.callId, question: args.question,
      ...(Array.isArray(args.choices) ? { options: args.choices.map((label: string) => ({ label })) } : {}) }] }
    if (result?.ok === true && typeof result.answer === 'string') content = [{ type: 'text', text: JSON.stringify({
      answers: [{ id: block.callId, selected: [], custom: result.answer }],
    }) }]
  }
  if (name === 'bash') {
    // Native standard-shell view requires a non-empty summary. This display
    // fallback is not an authored description or a persistent-shell capability.
    const terminalResult = Number.isInteger(result?.exitCode) && result.exitCode >= 0
      && typeof result.stdout === 'string' && typeof result.stderr === 'string'
    // Unknown settled exits (including CASE1's CLI results) must not enter the
    // native terminal parser, which assumes zero when its exit marker is absent.
    if (!('kind' in block) || terminalResult) mapped.description = args.command
    if (terminalResult) {
      content = [{ type: 'text', text: result.stdout + result.stderr + `\n[exit code: ${result.exitCode}]` }]
      // The native terminal owns exit failures; do not turn them into RPC errors.
      isError = false
    }
  }
  if (name === 'read' && result?.ok === true && typeof result.content === 'string'
    && Number.isInteger(result.startLine) && Number.isInteger(result.totalLines)) {
    meta = { path: result.path, offset: result.startLine, totalLines: result.totalLines,
      lines: result.content.split('\n').map((text: string, index: number) => ({ number: result.startLine + index, text })) }
    content = [{ type: 'text', text: `<path>${result.path}</path>\n<type>file</type>\n<content>\n${result.content}\n</content>` }]
  }
  const head = { ...call, name: toolName, argsRaw: JSON.stringify(mapped) }
  return { ...props, toolName, block: 'kind' in block
    ? { ...block, call: head, content, meta, isError } : head }
}
