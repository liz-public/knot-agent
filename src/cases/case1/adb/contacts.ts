import type { AdbExecutor } from './executor.js'
import { parseContentRows, shellQuote } from './parse.js'

const NAME_MIMETYPE = 'vnd.android.cursor.item/name'
const PHONE_MIMETYPE = 'vnd.android.cursor.item/phone_v2'

export interface ContactPhoneLookup {
  readonly contactId: number
  readonly rawContactId: number
  readonly displayName: string
  readonly nameDataId?: number
}

export async function lookupContactByPhone(executor: AdbExecutor, phone: string): Promise<ContactPhoneLookup | undefined> {
  const normalized = phone.replace(/\s+/g, '')
  const rows = parseContentRows(await executor.shellLines(
    `content query --uri content://com.android.contacts/phone_lookup/${encodeURIComponent(normalized)} --projection contact_id:display_name`,
  ))
  const first = rows[0]
  if (first === undefined) return undefined
  const contactId = Number(first['contact_id'])
  if (!Number.isInteger(contactId) || contactId < 1) return undefined
  const displayName = first['display_name'] ?? ''
  const rawContactId = await resolveRawContactId(executor, contactId)
  if (rawContactId === undefined) return undefined
  const nameDataId = await resolveNameDataId(executor, contactId)
  return { contactId, rawContactId, displayName, ...(nameDataId === undefined ? {} : { nameDataId }) }
}

async function resolveRawContactId(executor: AdbExecutor, contactId: number): Promise<number | undefined> {
  const rows = parseContentRows(await executor.shellLines(
    `content query --uri content://com.android.contacts/data --projection raw_contact_id --where "contact_id=${contactId} AND mimetype='${PHONE_MIMETYPE}'"`,
  ))
  const rawContactId = Number(rows[0]?.['raw_contact_id'])
  return Number.isInteger(rawContactId) && rawContactId > 0 ? rawContactId : undefined
}

async function resolveNameDataId(executor: AdbExecutor, contactId: number): Promise<number | undefined> {
  const rows = parseContentRows(await executor.shellLines(
    `content query --uri content://com.android.contacts/data --projection _id --where "contact_id=${contactId} AND mimetype='${NAME_MIMETYPE}'"`,
  ))
  const dataId = Number(rows[0]?.['_id'])
  return Number.isInteger(dataId) && dataId > 0 ? dataId : undefined
}

async function insertRawContact(executor: AdbExecutor): Promise<number> {
  await executor.shell(
    'content insert --uri content://com.android.contacts/raw_contacts --bind account_type:s:com.android.local --bind account_name:s:Phone',
  )
  const rows = parseContentRows(await executor.shellLines(
    'content query --uri content://com.android.contacts/raw_contacts --projection _id --sort "_id DESC"',
  ))
  const rawContactId = Number(rows[0]?.['_id'])
  if (!Number.isInteger(rawContactId) || rawContactId < 1) throw new Error('raw_contact_insert_failed')
  return rawContactId
}

async function bindContactData(
  executor: AdbExecutor,
  rawContactId: number,
  name: string,
  phone: string,
): Promise<void> {
  await executor.shell(
    `content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${rawContactId} --bind mimetype:s:${NAME_MIMETYPE} --bind data1:s:${shellQuote(name)}`,
  )
  await executor.shell(
    `content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${rawContactId} --bind mimetype:s:${PHONE_MIMETYPE} --bind data1:s:${shellQuote(phone)}`,
  )
}

export async function upsertContactByPhone(
  executor: AdbExecutor,
  phone: string,
  name: string,
): Promise<{ action: 'created' | 'updated'; contact_id: number; phone: string; name: string }> {
  const normalizedPhone = phone.replace(/\s+/g, '')
  const trimmedName = name.trim()
  const existing = await lookupContactByPhone(executor, normalizedPhone)
  if (existing === undefined) {
    const rawContactId = await insertRawContact(executor)
    await bindContactData(executor, rawContactId, trimmedName, normalizedPhone)
    const created = await lookupContactByPhone(executor, normalizedPhone)
    if (created === undefined) throw new Error('contact_create_verify_failed')
    return { action: 'created', contact_id: created.contactId, phone: normalizedPhone, name: trimmedName }
  }

  if (existing.nameDataId !== undefined) {
    await executor.shell(
      `content update --uri content://com.android.contacts/data --bind data1:s:${shellQuote(trimmedName)} --where "_id=${existing.nameDataId}"`,
    )
  } else {
    await executor.shell(
      `content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${existing.rawContactId} --bind mimetype:s:${NAME_MIMETYPE} --bind data1:s:${shellQuote(trimmedName)}`,
    )
  }
  return { action: 'updated', contact_id: existing.contactId, phone: normalizedPhone, name: trimmedName }
}

export async function deleteContactByPhone(executor: AdbExecutor, phone: string): Promise<boolean> {
  const existing = await lookupContactByPhone(executor, phone)
  if (existing === undefined) return false
  await executor.shell(`content delete --uri content://com.android.contacts/contacts/${existing.contactId}`)
  const after = await lookupContactByPhone(executor, phone)
  return after === undefined
}
