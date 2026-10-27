// IntelliShell-specific CodeMirror extensions: a Mongo-aware autocomplete (collection
// names after `db.`, collection/cursor methods after a member access, shell globals
// otherwise) and the run keymaps. Shared chrome (theme, highlight, language, line numbers,
// v-model) lives in components/base/CodeEditor.vue + utils/codemirror/theme.js.
import { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { bracketMatching, indentOnInput } from '@codemirror/language'

const GLOBALS = ['db', 'print', 'printjson', 'ObjectId', 'ISODate', 'UUID', 'NumberLong', 'NumberInt', 'NumberDecimal']
const DB_METHODS = ['getCollection', 'getCollectionNames', 'runCommand', 'stats', 'createCollection', 'dropDatabase']
const COLL_METHODS = [
  'find', 'findOne', 'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
  'deleteOne', 'deleteMany', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'distinct',
  'createIndex', 'dropIndex', 'getIndexes', 'drop', 'count', 'bulkWrite',
]
const CURSOR_METHODS = ['limit', 'skip', 'sort', 'projection', 'toArray', 'forEach', 'map', 'count', 'hasNext', 'next']

// `getCollections` is a function returning the current db's collection names (for
// completion after `db.`), kept as a getter so it can populate asynchronously.
function mongoCompletionSource(getCollections) {
  return (context) => {
    // `.member` access — offer methods (or collection names after `db`).
    const member = context.matchBefore(/\.[\w$]*$/)
    if (member) {
      const before = context.state.sliceDoc(0, member.from)
      const idMatch = /([\w$]+)\s*$/.exec(before)
      const object = idMatch ? idMatch[1] : ''
      let options
      if (object === 'db') {
        options = [
          ...getCollections().map((name) => ({ label: name, type: 'class' })),
          ...DB_METHODS.map((name) => ({ label: name, type: 'method' })),
        ]
      } else {
        options = [...COLL_METHODS, ...CURSOR_METHODS].map((name) => ({ label: name, type: 'method' }))
      }
      return { from: member.from + 1, options: options, validFor: /^[\w$]*$/ }
    }

    // Bare identifier — offer shell globals.
    const word = context.matchBefore(/[\w$]+/)
    if (!word || (word.from === word.to && !context.explicit)) return null
    return {
      from: word.from,
      options: GLOBALS.map((name) => ({ label: name, type: 'variable' })),
      validFor: /^[\w$]*$/,
    }
  }
}

// The shell uses a roomier line height than the other editors; layered over the base
// theme (later theme rules win).
const shellTheme = EditorView.theme({ '.cm-scroller': { lineHeight: '1.9' } })

// `onRun` runs the whole buffer; `onRunLine` receives the text of the line under the
// cursor; `getCollections` feeds db-collection completions. (Buffer sync to the tab is now
// CodeEditor's v-model.)
export function shellExtensions({ onRun, onRunLine, getCollections }) {
  return [
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    placeholder('db.getCollection("myCollection").find({}).limit(20)'),
    autocompletion({ override: [mongoCompletionSource(getCollections)] }),
    shellTheme,
    keymap.of([
      { key: 'Mod-Enter', preventDefault: true, run: () => { onRun(); return true } },
      {
        key: 'Mod-Shift-Enter',
        preventDefault: true,
        run: (view) => {
          const line = view.state.doc.lineAt(view.state.selection.main.head)
          onRunLine(line.text)
          return true
        },
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
  ]
}
