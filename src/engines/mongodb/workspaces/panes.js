// Lazy so CodeMirror and the rest stay out of startup (src/startupImports.test.js holds
// that line); declared once so every definition shares one component identity.
import { defineAsyncComponent } from 'vue'

export const MongoCollectionWorkspace = defineAsyncComponent(() => import('./collection/MongoCollectionWorkspace.vue'))
export const ShellConsole = defineAsyncComponent(() => import('../../../components/app/ShellConsole.vue'))
export const IndexManagerPane = defineAsyncComponent(() => import('../../../components/panes/IndexManagerPane.vue'))
export const SchemaPane = defineAsyncComponent(() => import('../../../components/panes/SchemaPane.vue'))
export const SearchPane = defineAsyncComponent(() => import('../../../components/panes/SearchPane.vue'))
export const CurrentOpsPane = defineAsyncComponent(() => import('../../../components/panes/CurrentOpsPane.vue'))
export const ImportPane = defineAsyncComponent(() => import('../../../components/panes/ImportPane.vue'))
export const CsvImportPane = defineAsyncComponent(() => import('../../../components/panes/CsvImportPane.vue'))
export const ExportPane = defineAsyncComponent(() => import('../../../components/panes/ExportPane.vue'))
