import { expect, it } from 'vitest'
import {
  historyRequest, saveQueryRequest, savedQueryBrowserRequest, docMenuRequest,
  requestHistory, requestSaveQuery, requestSavedQueryBrowser, requestDocAction,
} from './menuRequests'

it('each request lands on its own ref', () => {
  requestHistory()
  requestSaveQuery()
  requestSavedQueryBrowser()
  requestDocAction('doc:edit')
  expect(historyRequest.value.nonce).toBeDefined()
  expect(saveQueryRequest.value.nonce).toBeDefined()
  expect(savedQueryBrowserRequest.value.nonce).toBeDefined()
  expect(docMenuRequest.value).toMatchObject({ action: 'doc:edit' })
})

// The nonce exists so a watcher fires on a repeat of the same request; two requests
// back to back must therefore never share one.
it('every request is a new value, even back to back', () => {
  requestHistory()
  const first = historyRequest.value.nonce
  requestHistory()
  expect(historyRequest.value.nonce).not.toBe(first)
})

it('a doc action replaces the previous one', () => {
  requestDocAction('doc:edit')
  requestDocAction('doc:delete')
  expect(docMenuRequest.value.action).toBe('doc:delete')
})
