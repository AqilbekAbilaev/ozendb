// The MongoDB query workspaces that show a collection's documents. Find, Aggregate and
// SQL share one pane and one result stack, which is what the app means by "a collection
// tab": the document menus, paging and query code all act on any of the three.
const COLLECTION_TYPES = ['mongodb.find', 'mongodb.aggregate', 'mongodb.sql_to_mql']

export function isCollectionTab(tab) {
  return COLLECTION_TYPES.includes(tab?.type)
}
