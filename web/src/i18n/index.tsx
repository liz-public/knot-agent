import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en } from './en'
import { zhCN } from './zh-CN'

export type Locale = 'zh-CN' | 'en'
export type MessageKey = keyof typeof en
type Params = Readonly<Record<string, string | number>>

interface I18nValue {
  readonly locale: Locale
  readonly setLocale: (locale: Locale) => void
  readonly t: (key: MessageKey, params?: Params) => string
}

const storageKey = 'knot.locale'
const catalogs = { en, 'zh-CN': zhCN }
const I18nContext = createContext<I18nValue | undefined>(undefined)

function initialLocale(): Locale {
  const saved = window.localStorage.getItem(storageKey)
  if (saved === 'en' || saved === 'zh-CN') return saved
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale)
  useEffect(() => {
    window.localStorage.setItem(storageKey, locale)
    document.documentElement.lang = locale
  }, [locale])
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t(key, params = {}) {
      return Object.entries(params).reduce(
        (text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)),
        catalogs[locale][key],
      )
    },
  }), [locale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (value === undefined) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
