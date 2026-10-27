const PLACEHOLDER_URI = 'mongodb://localhost:27017'
const q = (value) => JSON.stringify(value)
const SPECIAL = new Set(['$oid', '$date', '$numberInt', '$numberLong', '$numberDouble', '$numberDecimal', '$regularExpression', '$binary', '$timestamp', '$symbol', '$code', '$undefined', '$minKey', '$maxKey', '$dbPointer'])

// Walk an EJSON tree collecting which special BSON types appear, so each scaffold can
// add exactly the type imports its snippet needs — and no unused ones (which matters
// for Go, where an unused import fails to compile).
export function collectTypes(node, acc) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, acc)
    return
  }
  const keys = Object.keys(node)
  if (keys.length === 1 && SPECIAL.has(keys[0])) {
    switch (keys[0]) {
      case '$oid': acc.add('objectId'); break
      case '$date': acc.add('date'); break
      case '$numberDecimal': acc.add('decimal'); break
      case '$regularExpression': acc.add('regex'); break
      default: break
    }
    return
  }
  for (const key of keys) collectTypes(node[key], acc)
}

export const SCAFFOLDS = {
  node: ({ db, query, types }) => {
    const extra = []
    if (types.has('objectId')) extra.push('ObjectId')
    if (types.has('decimal')) extra.push('Decimal128')
    const req = `const { MongoClient${extra.length ? ', ' + extra.join(', ') : ''} } = require('mongodb');`
    return [
      req,
      '',
      '// Connection URI — replace with your own',
      `const uri = ${q(PLACEHOLDER_URI)};`,
      'const client = new MongoClient(uri);',
      '',
      'async function run() {',
      '  try {',
      `    const db = client.db(${q(db)});`,
      `    const cursor = ${query};`,
      '    console.log(await cursor.toArray());',
      '  } finally {',
      '    await client.close();',
      '  }',
      '}',
      '',
      'run().catch(console.error);',
    ].join('\n')
  },
  python: ({ db, query, types }) => {
    const imports = ['from pymongo import MongoClient']
    if (types.has('objectId')) imports.push('from bson import ObjectId')
    if (types.has('decimal')) imports.push('from bson.decimal128 import Decimal128')
    if (types.has('regex')) imports.push('from bson.regex import Regex')
    if (types.has('date')) imports.push('from datetime import datetime')
    return [
      ...imports,
      '',
      '# Connection URI — replace with your own',
      `client = MongoClient(${q(PLACEHOLDER_URI)})`,
      `db = client[${q(db)}]`,
      '',
      `cursor = ${query}`,
      'for doc in cursor:',
      '    print(doc)',
      '',
      'client.close()',
    ].join('\n')
  },
  java: ({ db, coll, query, mode, types }) => {
    const imports = ['import com.mongodb.client.*;', 'import org.bson.Document;']
    if (mode === 'aggregate') imports.push('import java.util.Arrays;')
    if (types.has('objectId')) imports.push('import org.bson.types.ObjectId;')
    if (types.has('decimal')) imports.push('import org.bson.types.Decimal128;')
    if (types.has('regex')) imports.push('import org.bson.BsonRegularExpression;')
    return [
      ...imports,
      '',
      '// Connection URI — replace with your own',
      `try (MongoClient client = MongoClients.create(${q(PLACEHOLDER_URI)})) {`,
      `    MongoDatabase db = client.getDatabase(${q(db)});`,
      `    MongoCollection<Document> collection = db.getCollection(${q(coll)});`,
      `    for (Document doc : ${query}) {`,
      '        System.out.println(doc.toJson());',
      '    }',
      '}',
    ].join('\n')
  },
  csharp: ({ db, coll, query }) => {
    return [
      'using System;',
      'using MongoDB.Bson;',
      'using MongoDB.Driver;',
      '',
      '// Connection URI — replace with your own',
      `var client = new MongoClient(${q(PLACEHOLDER_URI)});`,
      `var db = client.GetDatabase(${q(db)});`,
      `var collection = db.GetCollection<BsonDocument>(${q(coll)});`,
      `var results = ${query}.ToList();`,
      'foreach (var doc in results)',
      '{',
      '    Console.WriteLine(doc);',
      '}',
    ].join('\n')
  },
  php: ({ db, coll, query }) => {
    return [
      '<?php',
      "require 'vendor/autoload.php';",
      '',
      '// Connection URI — replace with your own',
      `$client = new MongoDB\\Client(${q(PLACEHOLDER_URI)});`,
      `$collection = $client->selectCollection(${q(db)}, ${q(coll)});`,
      `$cursor = ${query};`,
      'foreach ($cursor as $doc) {',
      '    var_dump($doc);',
      '}',
    ].join('\n')
  },
  ruby: ({ db, query }) => {
    return [
      "require 'mongo'",
      '',
      '# Connection URI — replace with your own',
      `client = Mongo::Client.new(${q(PLACEHOLDER_URI)}, database: ${q(db)})`,
      '',
      `${query}.each do |doc|`,
      '  puts doc',
      'end',
    ].join('\n')
  },
  go: ({ db, coll, query, types }) => {
    const imports = ['\t"context"', '\t"fmt"']
    if (types.has('date')) imports.push('\t"time"')
    imports.push('\t"go.mongodb.org/mongo-driver/bson"')
    if (types.has('objectId') || types.has('decimal') || types.has('regex')) {
      imports.push('\t"go.mongodb.org/mongo-driver/bson/primitive"')
    }
    imports.push('\t"go.mongodb.org/mongo-driver/mongo"')
    imports.push('\t"go.mongodb.org/mongo-driver/mongo/options"')
    return [
      'package main',
      '',
      'import (',
      ...imports,
      ')',
      '',
      'func main() {',
      '\tctx := context.TODO()',
      '',
      '\t// Connection URI — replace with your own',
      `\tclient, err := mongo.Connect(ctx, options.Client().ApplyURI(${q(PLACEHOLDER_URI)}))`,
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tdefer client.Disconnect(ctx)',
      '',
      `\tcollection := client.Database(${q(db)}).Collection(${q(coll)})`,
      `\tcursor, err := ${query}`,
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tdefer cursor.Close(ctx)',
      '',
      '\tvar results []bson.M',
      '\tif err = cursor.All(ctx, &results); err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tfmt.Println(results)',
      '}',
    ].join('\n')
  },
}
