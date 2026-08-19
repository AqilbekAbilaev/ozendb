import { recordFrontendError } from '../appApi/errorLog'
import { HELP_REPO } from '../constants/helpLinks'

// Frontend half of error reporting. Two jobs: hand uncaught exceptions to the backend
// recorder (they never touch AppError's funnel, so nothing else would see them), and
// build the GitHub issue a user can choose to file from what was recorded.
//
// Only defects are recorded — a failed login is the user's server, not our bug. The
// filtering lives in Rust (error_log::is_defect); everything arriving here is already
// a defect by construction.

// A render loop that throws every frame would otherwise hammer the disk and bury the
// first (real) error under thousands of copies. The first errors are the informative
// ones, so the cap drops the tail rather than rotating.
const MAX_PER_SESSION = 20

// One error as reportable text. Engines disagree about `stack`: V8 starts it with
// "Error: message", JavaScriptCore (our WebKit webview) gives only the frames — so
// preferring `stack` alone drops the message entirely and records a bare "@". Compose
// both, unless the stack already carries the message.
export function describeError(err) {
  if (!err || typeof err !== 'object' || typeof err.message !== 'string') {
    return err == null ? '' : String(err)
  }
  const headline = `${err.name || 'Error'}: ${err.message}`
  const stack = typeof err.stack === 'string' ? err.stack : ''
  if (!stack) return headline
  return stack.startsWith(err.name || 'Error') ? stack : `${headline}\n${stack}`
}

export function installErrorReporting() {
  let sent = 0

  // Never throws and never rejects: a reporter that can fail is a reporter that
  // re-enters itself through the very handlers it installs.
  function report(message) {
    if (sent >= MAX_PER_SESSION || !message) return
    sent++
    recordFrontendError(message).catch(() => {})
  }

  window.addEventListener('error', (e) => {
    report(describeError(e.error) || e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    // Marked so an unhandled rejection is distinguishable from a thrown error: they
    // arrive with identical text otherwise, and they're different bugs to chase.
    report(`Unhandled rejection: ${describeError(e.reason)}`)
  })

  return report
}

// Records grouped by code, most frequent first — the shape the report leads with,
// since "17 × shell" is the part that says where to look.
export function summarize(records) {
  const counts = new Map()
  for (const r of records) {
    counts.set(r.code, (counts.get(r.code) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code: code, count: count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}

// The one identifier our own messages can carry is a file path under the user's home
// directory, which names their account. Swapped for `~` on the way into a report; the
// local log keeps the real path, since that's the copy they diagnose with.
export function scrub(text, home) {
  if (!home) return text
  return text.split(home).join('~')
}

// The issue body. Codes, counts and build context always; the messages themselves
// unless the user opts out — everything recorded is our own code (the allowlist keeps
// queries, documents and hosts out by construction), and a report without them says
// nothing actionable. Newest first: the last failure is usually the one they hit.
export function buildIssueBody(records, context, includeDetail) {
  const lines = [
    '### Environment',
    '',
    `- OzenDB ${context.version}`,
    `- ${context.os} (${context.arch})`,
    '',
    '### Recorded problems',
    '',
  ]
  const summary = summarize(records)
  if (!summary.length) {
    lines.push('_None recorded._')
  } else {
    for (const row of summary) lines.push(`- \`${row.code}\` × ${row.count}`)
  }
  if (includeDetail && records.length) {
    lines.push('', '### Details', '', '```')
    for (const r of [...records].reverse()) {
      lines.push(`[${new Date(r.at).toISOString()}] ${r.code}: ${scrub(r.message, context.home)}`)
    }
    lines.push('```')
  }
  lines.push('', '### What were you doing when this happened?', '', '')
  return lines.join('\n')
}

export function buildIssueUrl(records, context, includeDetail) {
  const summary = summarize(records)
  const title = summary.length
    ? `[error report] ${summary.map(r => r.code).join(', ')}`
    : '[error report]'
  const params = new URLSearchParams({
    title: title,
    body: buildIssueBody(records, context, includeDetail),
  })
  return `${HELP_REPO}/issues/new?${params}`
}
