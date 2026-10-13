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

/** Scheme positions ported from the device-verified SDK builder. No Android dependency. */
function ctripUri(path: string, fields: Record<string, string | number | undefined>): string {
  const query = Object.entries(fields).filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')
  return `${CTRIP_SCHEME}/${path}${query ? `?${query}` : ''}`
}

export interface FlightCity { readonly code: string; readonly cityId: number; readonly domestic: boolean }
export function ctripFlightListUri(input: {
  depart: FlightCity; arrive: FlightCity; date: string; returnDate?: string; cabin?: string; sort?: string
}): string {
  const domestic = input.depart.domestic && input.arrive.domestic, round = !!input.returnDate
  const cabin = input.cabin ?? 'economy'
  const cabinCode = domestic ? (['business', 'first', 'business_first'].includes(cabin) ? 5 : undefined)
    : ({ economy: 1, premium_economy: 2, business: 3, first: 4, business_first: 9 } as Record<string, number>)[cabin]
  const sort = ({ earliest: 1, latest: 2, cheapest: 3, priciest: 4 } as Record<string, number>)[input.sort ?? '']
  return ctripUri(`flight_${domestic ? 'inland' : 'int'}_${round ? 'tolist' : 'singlelist'}`, {
    c1: round ? 2 : 1, c2: input.depart.code, c3: input.arrive.code, c4: input.date, c5: input.returnDate,
    [domestic ? 'c6' : 'c7']: cabinCode, [domestic ? 'c7' : 'c8']: sort,
    dcityid: input.depart.cityId, acityid: input.arrive.cityId,
  })
}

export function ctripHotelListUri(input: {
  domestic: boolean; cityId: number; checkIn: string; checkOut: string; keyword?: string;
  brand?: string; sort?: string; near?: { latitude: number; longitude: number }
}): string {
  return ctripUri(`hotel_${input.domestic ? 'inland' : 'oversea'}_list`, {
    c1: input.checkIn, c2: input.checkOut, c3: input.cityId, c4: 0, c5: input.domestic ? 0 : 1,
    c24: input.keyword, c7: input.brand, c16: input.sort,
    c9: input.near ? 2 : undefined, c10: input.near?.latitude, c11: input.near?.longitude,
  })
}

export function ctripTrainListUri(depart: string, arrive: string, date: string, highSpeed: boolean): string {
  return ctripUri('train_list', { c1: depart.trim(), c2: arrive.trim(), c3: date, c6: highSpeed ? 1 : undefined })
}
