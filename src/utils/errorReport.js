import { invoke } from '@tauri-apps/api/core'
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

export function installErrorReporting() {
  let sent = 0

  // Never throws and never rejects: a reporter that can fail is a reporter that
  // re-enters itself through the very handlers it installs.
  function report(message) {
    if (sent >= MAX_PER_SESSION || !message) return
    sent++
    invoke('record_frontend_error', { message: String(message).slice(0, 4000) }).catch(() => {})
  }

  window.addEventListener('error', (e) => {
    report(e.error?.stack || e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    report(e.reason?.stack || e.reason?.message || e.reason)
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

// The issue body. Codes, counts and build context always; the messages themselves only
// when the user asks for them, because a message can name their hosts, databases and
// documents. Newest messages first — the last failure is usually the one they hit.
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
      lines.push(`[${new Date(r.at).toISOString()}] ${r.code}: ${r.message}`)
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
