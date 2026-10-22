import { errCode, errMessage } from '../../../utils/errors'

// A table tab's load failure, worded for the two a user can't fix by editing a filter:
// the table is gone, or the role may not read it. The server's own line stays, since it
// names which table (it may be a joined one).
const LEADS = {
  missing: 'This table can\'t be found — it may have been dropped or renamed.',
  forbidden: 'You don\'t have permission to read this.',
}

export function tableErrorText(e) {
  const lead = LEADS[errCode(e)]
  return lead ? `${lead} (${errMessage(e)})` : errMessage(e)
}
