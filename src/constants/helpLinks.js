// Help-menu link targets. Default to the project's real GitHub repo (from the git
// remote); retarget as needed once dedicated pages exist.
//
// A data table rather than a switch arm per item: every one of these menu ids does the
// same thing — open a URL — so the only thing that varies is the URL.
export const HELP_REPO = 'https://github.com/AqilbekAbilaev/ozendb'

export const HELP_URLS = {
  'help:license':         HELP_REPO,
  'help:gallery':         `${HELP_REPO}#readme`,
  'help:whats_new':       `${HELP_REPO}/releases`,
  'help:updates':         `${HELP_REPO}/releases`,
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
