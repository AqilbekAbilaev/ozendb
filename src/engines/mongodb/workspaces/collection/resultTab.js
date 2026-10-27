import { ref } from 'vue'

// Which result sub-tab the collection pane shows. Module-level rather than the pane's own
// state because the pane unmounts whenever another kind of tab activates, and the choice
// must survive switching back.
export const collectionResultTab = ref('Result')
