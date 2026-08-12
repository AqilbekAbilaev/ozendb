import { describe, it, expect } from 'vitest'
import { summarize, buildIssueBody, buildIssueUrl } from './errorReport'

// The one rule this file has to keep: a recorded message can name the user's hosts,
// databases and documents, so it must not reach the issue body unless asked for.
const RECORDS = [
  { code: 'shell', message: 'boom in prod-cluster.example.com', at: 1_700_000_000_000 },
  { code: 'io', message: 'tabs.json is unwritable', at: 1_700_000_001_000 },
  { code: 'shell', message: 'boom again', at: 1_700_000_002_000 },
]
const CONTEXT = { version: '0.1.4', os: 'linux', arch: 'x86_64' }

describe('summarize', () => {
  it('counts each code, most frequent first', () => {
    expect(summarize(RECORDS)).toEqual([
      { code: 'shell', count: 2 },
      { code: 'io', count: 1 },
    ])
  })

  it('breaks ties by code so the order is stable', () => {
    const tied = [{ code: 'serde' }, { code: 'io' }]
    expect(summarize(tied).map(r => r.code)).toEqual(['io', 'serde'])
  })

  it('handles an empty log', () => {
    expect(summarize([])).toEqual([])
  })
})

describe('buildIssueBody', () => {
  it('reports codes and build context without any message text', () => {
    const body = buildIssueBody(RECORDS, CONTEXT, false)
    expect(body).toContain('OzenDB 0.1.4')
    expect(body).toContain('linux (x86_64)')
    expect(body).toContain('`shell` × 2')
    expect(body).not.toContain('prod-cluster.example.com')
    expect(body).not.toContain('tabs.json is unwritable')
  })

  it('includes the messages only when detail is opted into', () => {
    const body = buildIssueBody(RECORDS, CONTEXT, true)
    expect(body).toContain('prod-cluster.example.com')
    expect(body).toContain('tabs.json is unwritable')
  })

  it('puts the newest message first, since that is the one just hit', () => {
    const body = buildIssueBody(RECORDS, CONTEXT, true)
    expect(body.indexOf('boom again')).toBeLessThan(body.indexOf('boom in prod-cluster'))
  })

  it('still produces a usable body with nothing recorded', () => {
    const body = buildIssueBody([], CONTEXT, true)
    expect(body).toContain('_None recorded._')
    expect(body).toContain('OzenDB 0.1.4')
  })
})

describe('buildIssueUrl', () => {
  it('targets the project repo and names the codes in the title', () => {
    const url = buildIssueUrl(RECORDS, CONTEXT, false)
    expect(url.startsWith('https://github.com/AqilbekAbilaev/ozendb/issues/new?')).toBe(true)
    expect(decodeURIComponent(new URL(url).searchParams.get('title'))).toBe('[error report] shell, io')
  })

  it('escapes the body so backticks and newlines survive the query string', () => {
    const url = buildIssueUrl(RECORDS, CONTEXT, true)
    const body = new URL(url).searchParams.get('body')
    expect(body).toContain('prod-cluster.example.com')
    expect(body).toContain('### Environment')
  })
})
