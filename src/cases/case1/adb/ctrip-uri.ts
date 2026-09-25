const CTRIP_SCHEME = 'ctrip://wireless'

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value)
}

function wrapRnPathInH5Scheme(rnPath: string): string {
  const b64 = Buffer.from(rnPath, 'utf8').toString('base64')
  return `ctrip://wireless/h5?url=${b64}&type=5`
}

export function ctripTicketInquireUri(): string {
  return `${CTRIP_SCHEME}/ticket_inquire`
}

export function ctripTicketListUri(keyword: string): string {
  const params = new URLSearchParams({
    CRNModuleName: 'CtripApp',
    CRNType: '1',
    isHideNavBar: 'YES',
    disableAnimation: 'YES',
    sourceFrom: 'homehotsearch',
    keyword,
    datatype: 'all',
    tabReq: 'true',
  })
  const inner = `/rn_search/_crn_config?${[...params.entries()]
    .map(([key, value]) => `${key}=${encodeQueryComponent(value)}`)
    .join('&')}`
  return wrapRnPathInH5Scheme(inner)
}

export const CTRIP_PACKAGE = 'ctrip.android.view'
