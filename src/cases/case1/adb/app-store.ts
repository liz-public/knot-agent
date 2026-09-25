const enc = encodeURIComponent

export const SAMSUNG_GALAXY_STORE_PACKAGE = 'com.sec.android.app.samsungapps'

/** Samsung Galaxy Store search — opens SearchResultActivity (verified SM-F7410). */
export function samsungGalaxyStoreSearchUri(keyword: string): string {
  return `samsungapps://SearchResult/${enc(keyword)}`
}

/** Generic market search — resolves to the system default store (e.g. Play Store). */
export function marketStoreSearchUri(keyword: string): string {
  return `market://search?q=${enc(keyword)}`
}
