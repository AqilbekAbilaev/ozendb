// Help-menu link targets. Default to the project's real GitHub repo (from the git
// remote); retarget as needed once dedicated pages exist.
//
// A data table rather than a switch arm per item: every one of these menu ids does the
// same thing — open a URL — so the only thing that varies is the URL.
export const HELP_REPO = 'https://github.com/AqilbekAbilaev/ozendb'

// Where an install that can't replace itself (deb/rpm) is sent to get the new version.
export const RELEASES_URL = `${HELP_REPO}/releases`

// Note `help:updates` is deliberately absent: it runs a real update check (see
// useUpdater), and listing it here would make the link handler swallow it first.
export const HELP_URLS = {
  'help:license':         HELP_REPO,
  'help:gallery':         `${HELP_REPO}#readme`,
  'help:whats_new':       RELEASES_URL,
  'help:support':         `${HELP_REPO}/issues`,
  'help:feature_request': `${HELP_REPO}/issues/new`,
  'help:feedback':        `${HELP_REPO}/issues/new`,
  'help:tutorials':       `${HELP_REPO}/wiki`,
  'help:knowledge_base':  `${HELP_REPO}/wiki`,
}

/// Whether a menu id is one of the plain "open a URL" help items.
export function isHelpLink(id) {
  return Object.prototype.hasOwnProperty.call(HELP_URLS, id)
}
