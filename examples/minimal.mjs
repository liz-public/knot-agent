import { createJournal } from '../dist/src/journal.js'

const USER_MESSAGE = 'user.message'
const ASSISTANT_MESSAGE = 'assistant.message'

const reply = journal => {
  journal.subscribe(USER_MESSAGE, event => {
    journal.append(ASSISTANT_MESSAGE, {
      content: `You said: ${event.data.content}`,
    })
  })
}

const print = journal => {
  journal.subscribe(ASSISTANT_MESSAGE, event => {
    process.stdout.write(`${event.data.content}\n`)
  })
}

const { journal, runUntilIdle } = createJournal()
reply(journal)
print(journal)
journal.append(USER_MESSAGE, { content: process.argv[2] ?? 'hello' })
await runUntilIdle()
