import type { ToolExecution } from './tools.js'

const functions: Readonly<Record<string, (value: number) => number>> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  ln: Math.log, log10: Math.log10, floor: Math.floor, ceil: Math.ceil,
  // Preserve the Android implementation's ties-to-even rounding.
  round: value => {
    const floor = Math.floor(value)
    return value - floor === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value)
  },
}

/** Restricted arithmetic grammar; never evaluates JavaScript or accesses objects. */
export function calculate(expression: string): ToolExecution {
  try {
    if (!expression.trim()) throw new Error('表达式不能为空')
    if (expression.length > 512) throw new Error('表达式不能超过 512 个字符')
    let position = 0, depth = 0
    const skip = () => { while (/\s/.test(expression[position] ?? '') && position < expression.length) position++ }
    const take = (character: string) => {
      skip()
      if (expression[position] !== character) return false
      position++
      return true
    }
    const finite = (value: number) => {
      if (!Number.isFinite(value)) throw new Error('运算结果不是有限实数')
      return value
    }
    const sum = (): number => {
      let value = product()
      for (;;) {
        if (take('+')) value = finite(value + product())
        else if (take('-')) value = finite(value - product())
        else return value
      }
    }
    const product = (): number => {
      let value = factor()
      for (;;) {
        if (take('*')) value = finite(value * factor())
        else if (take('/')) {
          const divisor = factor()
          if (divisor === 0) throw new Error('除数为零')
          value = finite(value / divisor)
        } else if (take('%')) {
          const divisor = factor()
          if (divisor === 0) throw new Error('取模除数为零')
          value = finite(value % divisor)
        } else return value
      }
    }
    const factor = (): number => {
      if (++depth > 40) throw new Error('表达式嵌套过深')
      try {
        if (take('+')) return factor()
        if (take('-')) return -factor()
        let value: number
        if (take('(')) {
          value = sum()
          if (!take(')')) throw new Error('缺少右括号')
        } else {
          skip()
          const token = expression.slice(position).match(/^(?:\d+(?:\.\d*)?|\.\d+)|^[a-zA-Z][a-zA-Z0-9_]*/)?.[0]
          if (!token) throw new Error('缺少数字或合法函数')
          position += token.length
          if (/^[\d.]/.test(token)) value = Number(token)
          else {
            const fn = Object.hasOwn(functions, token.toLowerCase()) ? functions[token.toLowerCase()] : undefined
            if (!fn) throw new Error(`不支持的函数：${token}`)
            if (!take('(')) throw new Error('函数缺少左括号')
            value = fn(sum())
            if (!take(')')) throw new Error('函数缺少右括号')
          }
        }
        return finite(take('^') ? value ** factor() : value)
      } finally { depth-- }
    }
    const result = sum()
    skip()
    if (position !== expression.length) throw new Error('表达式尾部有多余字符')
    return { content: JSON.stringify({ ok: true, expression, result }) }
  } catch (error) {
    return { content: JSON.stringify({ ok: false, error: 'arithmetic_error',
      message: error instanceof Error ? error.message : String(error),
      hint: '请修正算术表达式；用 help calc 查看支持的运算与示例。' }) }
  }
}
