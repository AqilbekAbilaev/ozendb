import { expect, it } from 'vitest'
import {
  historyRequest, saveQueryRequest, savedQueryBrowserRequest, docMenuRequest, indexMenuRequest,
  requestHistory, requestSaveQuery, requestSavedQueryBrowser, requestDocAction, requestIndexAction,
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

// The Index menu acts on whichever Index Manager is open, so the request names the pane
// method and its arguments rather than reaching into the tab.
it('an index action carries its method and arguments', () => {
  requestIndexAction('setIndexHidden', true)
  expect(indexMenuRequest.value).toMatchObject({ method: 'setIndexHidden', args: [true] })
  requestIndexAction('copyIndex')
  expect(indexMenuRequest.value).toMatchObject({ method: 'copyIndex', args: [] })
})
