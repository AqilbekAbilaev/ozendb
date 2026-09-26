// Maps a language id to its CodeMirror language extension. JS/EJSON use the JS grammar;
// the rest come from official grammars (@codemirror/lang-php) or the legacy stream modes
// (@codemirror/legacy-modes). Their tokens map to the standard Lezer highlight tags, so
// the shared HighlightStyle in ./theme.js colours every language without extra work.
import { javascript } from '@codemirror/lang-javascript'
import { php } from '@codemirror/lang-php'
import { StreamLanguage } from '@codemirror/language'
import { python } from '@codemirror/legacy-modes/mode/python'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { go } from '@codemirror/legacy-modes/mode/go'
import { java, csharp } from '@codemirror/legacy-modes/mode/clike'
import { pgSQL } from '@codemirror/legacy-modes/mode/sql'

export function languageExtension(language) {
  switch (language) {
    case 'python': return StreamLanguage.define(python)
    case 'ruby':   return StreamLanguage.define(ruby)
    case 'go':     return StreamLanguage.define(go)
    case 'java':   return StreamLanguage.define(java)
    case 'csharp': return StreamLanguage.define(csharp)
    case 'php':    return php()
    case 'sql':    return StreamLanguage.define(pgSQL)
    // 'js' (also used for Node.js and the Mongo shell, which are JS syntax) and anything
    // unrecognised fall back to the JS grammar.
    case 'js':
    default:       return javascript()
  }
}
