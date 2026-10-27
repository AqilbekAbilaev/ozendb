import { describe, it, expect } from 'vitest'
import { generateCode, LANGUAGES } from './queryCodegen'

// queryCodegen.js turns the raw shell-syntax query fields off a tab into an idiomatic
// snippet for eight drivers. These lock the per-language idioms, value rendering and the
// invalid-query behaviour.

const findSpec = {
  collection: 'users',
  mode: 'find',
  filter: '{ status: "active", age: { $gt: 18 } }',
  projection: '{ name: 1, _id: 0 }',
  sort: '{ age: -1 }',
  skip: 20,
  limit: 50,
}

const aggSpec = {
  collection: 'orders',
  mode: 'aggregate',
  pipeline: '[ { $match: { status: "shipped" } }, { $group: { _id: "$region", total: { $sum: 1 } } } ]',
}

describe('LANGUAGES', () => {
  it('has 8 entries with Shell first', () => {
    expect(LANGUAGES).toHaveLength(8)
    expect(LANGUAGES[0]).toEqual({ id: 'shell', label: 'Shell' })
    expect(LANGUAGES.map((l) => l.id)).toEqual(
      ['shell', 'node', 'python', 'java', 'csharp', 'php', 'ruby', 'go'],
    )
  })
})

describe('shell (unchanged passthrough)', () => {
  it('renders a find from the raw strings', () => {
    expect(generateCode(findSpec, 'shell')).toBe(
      'db.users.find({ status: "active", age: { $gt: 18 } }, { name: 1, _id: 0 }).sort({ age: -1 }).skip(20).limit(50)',
    )
  })
  it('renders an aggregate from the raw string', () => {
    expect(generateCode(aggSpec, 'shell')).toBe(
      'db.orders.aggregate([ { $match: { status: "shipped" } }, { $group: { _id: "$region", total: { $sum: 1 } } } ])',
    )
  })
  it('defaults limit to 50 like the old computed', () => {
    expect(generateCode({ collection: 'c', mode: 'find', filter: '{}' }, 'shell')).toBe(
      'db.c.find({}).limit(50)',
    )
  })
})

// The query call is now embedded in a full runnable program (see the "driver scaffold"
// block below); these lock the per-language call idiom via .toContain.
describe('find — per language (query call)', () => {
  it('node', () => {
    expect(generateCode(findSpec, 'node')).toContain(
      'db.collection("users").find({ "status": "active", "age": { "$gt": 18 } }, { projection: { "name": 1, "_id": 0 } }).sort({ "age": -1 }).skip(20).limit(50)',
    )
  })
  it('python (sort is a list of tuples)', () => {
    expect(generateCode(findSpec, 'python')).toContain(
      'db.users.find({"status": "active", "age": {"$gt": 18}}, {"name": 1, "_id": 0}).sort([("age", -1)]).skip(20).limit(50)',
    )
  })
  it('java (Document builder)', () => {
    expect(generateCode(findSpec, 'java')).toContain(
      'collection.find(new Document("status", "active").append("age", new Document("$gt", 18)))' +
      '.projection(new Document("name", 1).append("_id", 0)).sort(new Document("age", -1)).skip(20).limit(50)',
    )
  })
  it('csharp (BsonDocument)', () => {
    expect(generateCode(findSpec, 'csharp')).toContain(
      'collection.Find(new BsonDocument { { "status", "active" }, { "age", new BsonDocument { { "$gt", 18 } } } })' +
      '.Project(new BsonDocument { { "name", 1 }, { "_id", 0 } }).Sort(new BsonDocument { { "age", -1 } }).Skip(20).Limit(50)',
    )
  })
  it('php (options array)', () => {
    expect(generateCode(findSpec, 'php')).toContain(
      '$collection->find(["status" => "active", "age" => ["$gt" => 18]], ' +
      '["projection" => ["name" => 1, "_id" => 0], "sort" => ["age" => -1], "skip" => 20, "limit" => 50])',
    )
  })
  it('ruby (fluent hash)', () => {
    expect(generateCode(findSpec, 'ruby')).toContain(
      'client[:users].find({ "status" => "active", "age" => { "$gt" => 18 } })' +
      '.projection({ "name" => 1, "_id" => 0 }).sort({ "age" => -1 }).skip(20).limit(50)',
    )
  })
  it('go (bson.D + options builder)', () => {
    expect(generateCode(findSpec, 'go')).toContain(
      'collection.Find(ctx, bson.D{{Key: "status", Value: "active"}, {Key: "age", Value: bson.D{{Key: "$gt", Value: 18}}}}, ' +
      'options.Find().SetProjection(bson.D{{Key: "name", Value: 1}, {Key: "_id", Value: 0}}).SetSort(bson.D{{Key: "age", Value: -1}}).SetSkip(20).SetLimit(50))',
    )
  })
})

describe('aggregate — per language (query call)', () => {
  it('node', () => {
    expect(generateCode(aggSpec, 'node')).toContain(
      'db.collection("orders").aggregate([{ "$match": { "status": "shipped" } }, { "$group": { "_id": "$region", "total": { "$sum": 1 } } }])',
    )
  })
  it('java wraps stages in Arrays.asList', () => {
    expect(generateCode(aggSpec, 'java')).toContain(
      'collection.aggregate(Arrays.asList(new Document("$match", new Document("status", "shipped")), ' +
      'new Document("$group", new Document("_id", "$region").append("total", new Document("$sum", 1)))))',
    )
  })
  it('csharp uses a BsonDocument[] pipeline', () => {
    expect(generateCode(aggSpec, 'csharp')).toContain(
      'collection.Aggregate<BsonDocument>(new BsonDocument[] { ' +
      'new BsonDocument { { "$match", new BsonDocument { { "status", "shipped" } } } }, ' +
      'new BsonDocument { { "$group", new BsonDocument { { "_id", "$region" }, { "total", new BsonDocument { { "$sum", 1 } } } } } } })',
    )
  })
  it('go uses mongo.Pipeline', () => {
    expect(generateCode(aggSpec, 'go')).toContain(
      'collection.Aggregate(ctx, mongo.Pipeline{bson.D{{Key: "$match", Value: bson.D{{Key: "status", Value: "shipped"}}}}, ' +
      'bson.D{{Key: "$group", Value: bson.D{{Key: "_id", Value: "$region"}, {Key: "total", Value: bson.D{{Key: "$sum", Value: 1}}}}}}})',
    )
  })
})

describe('driver scaffold (connect → collection → run)', () => {
  it('node wraps the call in client construction, db handle and a result read', () => {
    const out = generateCode(findSpec, 'node')
    expect(out).toContain("const { MongoClient } = require('mongodb');")
    expect(out).toContain('const client = new MongoClient(uri);')
    expect(out).toContain('const db = client.db("mydb");')
    expect(out).toContain('console.log(await cursor.toArray());')
    expect(out).toContain('await client.close();')
  })
  it('embeds a placeholder URI, never a real one', () => {
    for (const lang of ['node', 'python', 'java', 'csharp', 'php', 'ruby', 'go']) {
      expect(generateCode(findSpec, lang)).toContain('mongodb://localhost:27017')
    }
  })
  it('uses the real database name when the spec provides one', () => {
    expect(generateCode({ ...findSpec, database: 'shop' }, 'node')).toContain('client.db("shop")')
    expect(generateCode({ ...findSpec, database: 'shop' }, 'go')).toContain('client.Database("shop")')
  })
  it('falls back to a mydb placeholder when no database is given', () => {
    expect(generateCode(findSpec, 'python')).toContain('db = client["mydb"]')
  })
  it('python imports ObjectId only when the query uses one', () => {
    const withId = { collection: 'c', mode: 'find', filter: '{ _id: ObjectId("507f1f77bcf86cd799439011") }' }
    expect(generateCode(withId, 'python')).toContain('from bson import ObjectId')
    expect(generateCode({ collection: 'c', mode: 'find', filter: '{}' }, 'python')).not.toContain('from bson import ObjectId')
  })
  it('go imports the primitive package only when needed (unused import would not compile)', () => {
    const withId = { collection: 'c', mode: 'find', filter: '{ _id: ObjectId("507f1f77bcf86cd799439011") }' }
    expect(generateCode(withId, 'go')).toContain('bson/primitive')
    expect(generateCode({ collection: 'c', mode: 'find', filter: '{}' }, 'go')).not.toContain('bson/primitive')
  })
  it('java imports Arrays only for aggregate pipelines', () => {
    expect(generateCode(aggSpec, 'java')).toContain('import java.util.Arrays;')
    expect(generateCode(findSpec, 'java')).not.toContain('import java.util.Arrays;')
  })
})

describe('ObjectId rendering', () => {
  const spec = { collection: 'c', mode: 'find', filter: '{ _id: ObjectId("507f1f77bcf86cd799439011") }' }
  it('node', () => {
    expect(generateCode(spec, 'node')).toContain('new ObjectId("507f1f77bcf86cd799439011")')
  })
  it('python', () => {
    expect(generateCode(spec, 'python')).toContain('ObjectId("507f1f77bcf86cd799439011")')
  })
  it('java', () => {
    expect(generateCode(spec, 'java')).toContain('new ObjectId("507f1f77bcf86cd799439011")')
  })
  it('csharp', () => {
    expect(generateCode(spec, 'csharp')).toContain('new ObjectId("507f1f77bcf86cd799439011")')
  })
  it('go (with error note)', () => {
    const out = generateCode(spec, 'go')
    expect(out).toContain('primitive.ObjectIDFromHex("507f1f77bcf86cd799439011")')
    expect(out).toContain('also return an error to handle')
  })
})

describe('Date rendering', () => {
  const spec = { collection: 'c', mode: 'find', filter: '{ created: ISODate("2021-01-02T03:04:05Z") }' }
  it('node', () => {
    expect(generateCode(spec, 'node')).toContain('new Date("2021-01-02T03:04:05.000Z")')
  })
  it('python', () => {
    expect(generateCode(spec, 'python')).toContain('datetime.fromisoformat("2021-01-02T03:04:05.000Z")')
  })
  it('java uses epoch millis', () => {
    expect(generateCode(spec, 'java')).toContain(`new java.util.Date(${Date.parse('2021-01-02T03:04:05Z')}L)`)
  })
  it('csharp', () => {
    expect(generateCode(spec, 'csharp')).toContain('DateTime.Parse("2021-01-02T03:04:05.000Z")')
  })
  it('go', () => {
    expect(generateCode(spec, 'go')).toContain('time.Parse(time.RFC3339, "2021-01-02T03:04:05.000Z")')
  })
})

describe('nested object + array rendering', () => {
  const spec = { collection: 'c', mode: 'find', filter: '{ tags: ["a", "b"], meta: { level: 2 } }' }
  it('node', () => {
    expect(generateCode(spec, 'node')).toContain(
      'db.collection("c").find({ "tags": ["a", "b"], "meta": { "level": 2 } })',
    )
  })
  it('go nests bson.D and bson.A', () => {
    expect(generateCode(spec, 'go')).toContain(
      'bson.D{{Key: "tags", Value: bson.A{"a", "b"}}, {Key: "meta", Value: bson.D{{Key: "level", Value: 2}}}}',
    )
  })
})

describe('invalid query → fix-first comment marker', () => {
  const bad = { collection: 'c', mode: 'find', filter: '{ oops: }' }
  it('uses // for node/java/csharp/php/go', () => {
    expect(generateCode(bad, 'node')).toBe('// Fix the query before generating code')
    expect(generateCode(bad, 'java')).toBe('// Fix the query before generating code')
    expect(generateCode(bad, 'go')).toBe('// Fix the query before generating code')
  })
  it('uses # for python/ruby', () => {
    expect(generateCode(bad, 'python')).toBe('# Fix the query before generating code')
    expect(generateCode(bad, 'ruby')).toBe('# Fix the query before generating code')
  })
})

describe('field/key order is preserved', () => {
  it('keeps b before a in a sort', () => {
    const spec = { collection: 'c', mode: 'find', filter: '{}', sort: '{ b: 1, a: -1 }' }
    expect(generateCode(spec, 'python')).toContain('.sort([("b", 1), ("a", -1)])')
    expect(generateCode(spec, 'node')).toContain('.sort({ "b": 1, "a": -1 })')
  })
})

describe('empty state', () => {
  it('returns empty string with no collection', () => {
    expect(generateCode({ mode: 'find', filter: '{}' }, 'node')).toBe('')
    expect(generateCode(null, 'node')).toBe('')
  })
})
