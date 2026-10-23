// Real plans in EXPLAIN FORMAT=JSON's second version, captured from MySQL 8.4: the shape
// planRows reads. owners (id, name, KEY by_name) and pets (id, owner_id, kind, KEY by_owner).

// EXPLAIN ANALYZE of a join with an IN subquery, a GROUP BY and an ORDER BY.
export const analyzedPlan = {
  "query": "/* select#1 */ select `o`.`name` AS `name`,count(0) AS `COUNT(*)` from `explain probe`.`owners` `o` join `explain probe`.`pets` `p` semi join (`explain probe`.`pets`) where ((`explain probe`.`pets`.`owner_id` = `o`.`id`) and (`p`.`owner_id` = `o`.`id`) and (`explain probe`.`pets`.`kind` = 'cat')) group by `explain probe`.`o`.`name` order by `COUNT(*)` desc",
  "inputs": [
    {
      "inputs": [
        {
          "inputs": [
            {
              "inputs": [
                {
                  "inputs": [
                    {
                      "alias": "o",
                      "covering": true,
                      "operation": "Covering index scan on o using by_name",
                      "index_name": "by_name",
                      "table_name": "owners",
                      "access_type": "index",
                      "actual_rows": 3.0,
                      "schema_name": "explain probe",
                      "actual_loops": 1,
                      "used_columns": [
                        "id",
                        "name"
                      ],
                      "estimated_rows": 3.0,
                      "index_access_type": "index_scan",
                      "actual_last_row_ms": 0.020964,
                      "actual_first_row_ms": 0.012965,
                      "estimated_total_cost": 0.55
                    },
                    {
                      "inputs": [
                        {
                          "operation": "Table scan on pets",
                          "table_name": "pets",
                          "access_type": "table",
                          "actual_rows": 4.0,
                          "schema_name": "explain probe",
                          "actual_loops": 1,
                          "used_columns": [
                            "id",
                            "owner_id",
                            "kind"
                          ],
                          "estimated_rows": 4.0,
                          "actual_last_row_ms": 0.061599,
                          "actual_first_row_ms": 0.057088,
                          "estimated_total_cost": 0.21701494852701822
                        }
                      ],
                      "heading": "Hash",
                      "condition": "(pets.kind = 'cat')",
                      "operation": "Filter: (pets.kind = 'cat')",
                      "access_type": "filter",
                      "actual_rows": 2.0,
                      "actual_loops": 1,
                      "estimated_rows": 1.0,
                      "actual_last_row_ms": 0.065386,
                      "actual_first_row_ms": 0.059311,
                      "estimated_total_cost": 0.21701494852701822
                    }
                  ],
                  "join_type": "semijoin",
                  "operation": "Hash semijoin (pets.owner_id = o.id)",
                  "access_type": "join",
                  "actual_rows": 2.0,
                  "actual_loops": 1,
                  "estimated_rows": 0.75,
                  "hash_condition": [
                    "(pets.owner_id = o.id)"
                  ],
                  "join_algorithm": "hash",
                  "actual_last_row_ms": 0.110171,
                  "actual_first_row_ms": 0.09594000000000001,
                  "estimated_total_cost": 1.068059794108073
                },
                {
                  "alias": "p",
                  "covering": true,
                  "operation": "Covering index lookup on p using by_owner (owner_id=o.id)",
                  "index_name": "by_owner",
                  "table_name": "pets",
                  "access_type": "index",
                  "actual_rows": 1.5,
                  "schema_name": "explain probe",
                  "actual_loops": 2,
                  "used_columns": [
                    "id",
                    "owner_id"
                  ],
                  "estimated_rows": 1.3333333730697632,
                  "lookup_condition": "owner_id=o.id",
                  "index_access_type": "index_lookup",
                  "actual_last_row_ms": 0.0185565,
                  "actual_first_row_ms": 0.0121845,
                  "estimated_total_cost": 0.29453592034996623
                }
              ],
              "join_type": "inner join",
              "operation": "Nested loop inner join",
              "access_type": "join",
              "actual_rows": 3.0,
              "actual_loops": 1,
              "estimated_rows": 1.0000000298023224,
              "join_algorithm": "nested_loop",
              "actual_last_row_ms": 0.15403,
              "actual_first_row_ms": 0.11083799999999999,
              "estimated_total_cost": 1.9183342208312275
            }
          ],
          "operation": "Aggregate using temporary table",
          "access_type": "temp_table_aggregate",
          "actual_rows": 2.0,
          "actual_loops": 1,
          "actual_last_row_ms": 4.123713,
          "actual_first_row_ms": 4.123713
        }
      ],
      "operation": "Table scan on <temporary>",
      "table_name": "<temporary>",
      "access_type": "table",
      "actual_rows": 2.0,
      "actual_loops": 1,
      "actual_last_row_ms": 4.128391000000001,
      "actual_first_row_ms": 4.12692
    }
  ],
  "operation": "Sort: `COUNT(*)` DESC",
  "query_type": "select",
  "access_type": "sort",
  "actual_rows": 2.0,
  "sort_fields": [
    "`COUNT(*)` DESC"
  ],
  "actual_loops": 1,
  "actual_last_row_ms": 4.150384,
  "actual_first_row_ms": 4.149751999999999
}

// EXPLAIN, without running it, of a multi-table UPDATE.
export const estimatedPlan = {
  "query": "update `explain probe`.`pets` `p` join `explain probe`.`owners` `o` set `p`.`kind` = 'owl' where ((`p`.`owner_id` = `o`.`id`) and (`o`.`name` = 'Åsa'))",
  "inputs": [
    {
      "inputs": [
        {
          "alias": "o",
          "covering": true,
          "operation": "Covering index lookup on o using by_name (name='Åsa')",
          "index_name": "by_name",
          "table_name": "owners",
          "access_type": "index",
          "schema_name": "explain probe",
          "used_columns": [
            "id",
            "name"
          ],
          "estimated_rows": 1.0,
          "lookup_condition": "name='Åsa'",
          "index_access_type": "index_lookup",
          "estimated_total_cost": 0.35
        },
        {
          "alias": "p",
          "covering": false,
          "operation": "Index lookup on p using by_owner (owner_id=o.id)",
          "index_name": "by_owner",
          "table_name": "pets",
          "access_type": "index",
          "schema_name": "explain probe",
          "used_columns": [
            "id",
            "owner_id",
            "kind"
          ],
          "estimated_rows": 1.3333333730697632,
          "lookup_condition": "owner_id=o.id",
          "index_access_type": "index_lookup",
          "estimated_total_cost": 0.4666666805744171
        }
      ],
      "join_type": "inner join",
      "operation": "Nested loop inner join",
      "access_type": "join",
      "estimated_rows": 1.3333333730697632,
      "join_algorithm": "nested_loop",
      "estimated_total_cost": 0.8166666805744172
    }
  ],
  "operation": "Update p (buffered)",
  "query_type": "update"
}

// Real plans in the classic EXPLAIN FORMAT=JSON, captured from MySQL 8.0 on the same
// tables. MySQL 8.0 – 8.2 explains this way, without running.

// A join with an IN subquery, a GROUP BY and an ORDER BY.
export const classicJoin = {
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "2.55"
    },
    "ordering_operation": {
      "using_filesort": true,
      "grouping_operation": {
        "using_temporary_table": true,
        "using_filesort": false,
        "nested_loop": [
          {
            "table": {
              "table_name": "o",
              "access_type": "index",
              "possible_keys": [
                "PRIMARY",
                "by_name"
              ],
              "key": "by_name",
              "used_key_parts": [
                "name"
              ],
              "key_length": "163",
              "rows_examined_per_scan": 3,
              "rows_produced_per_join": 3,
              "filtered": "100.00",
              "using_index": true,
              "cost_info": {
                "read_cost": "0.25",
                "eval_cost": "0.30",
                "prefix_cost": "0.55",
                "data_read_per_join": "504"
              },
              "used_columns": [
                "id",
                "name"
              ]
            }
          },
          {
            "table": {
              "table_name": "pets",
              "access_type": "ALL",
              "possible_keys": [
                "by_owner"
              ],
              "rows_examined_per_scan": 4,
              "rows_produced_per_join": 3,
              "filtered": "25.00",
              "first_match": "o",
              "using_join_buffer": "hash join",
              "cost_info": {
                "read_cost": "0.55",
                "eval_cost": "0.30",
                "prefix_cost": "1.40",
                "data_read_per_join": "288"
              },
              "used_columns": [
                "id",
                "owner_id",
                "kind"
              ],
              "attached_condition": "((`explain probe`.`pets`.`owner_id` = `explain probe`.`o`.`id`) and (`explain probe`.`pets`.`kind` = 'cat'))"
            }
          },
          {
            "table": {
              "table_name": "p",
              "access_type": "ref",
              "possible_keys": [
                "by_owner"
              ],
              "key": "by_owner",
              "used_key_parts": [
                "owner_id"
              ],
              "key_length": "5",
              "ref": [
                "explain probe.o.id"
              ],
              "rows_examined_per_scan": 1,
              "rows_produced_per_join": 4,
              "filtered": "100.00",
              "using_index": true,
              "cost_info": {
                "read_cost": "0.75",
                "eval_cost": "0.40",
                "prefix_cost": "2.55",
                "data_read_per_join": "384"
              },
              "used_columns": [
                "id",
                "owner_id"
              ]
            }
          }
        ]
      }
    }
  }
}

// A UNION, which removes duplicates in a temporary table.
export const classicUnion = {
  "query_block": {
    "union_result": {
      "using_temporary_table": true,
      "select_id": 3,
      "table_name": "<union1,2>",
      "access_type": "ALL",
      "query_specifications": [
        {
          "dependent": false,
          "cacheable": true,
          "query_block": {
            "select_id": 1,
            "cost_info": {
              "query_cost": "0.55"
            },
            "table": {
              "table_name": "owners",
              "access_type": "index",
              "key": "by_name",
              "used_key_parts": [
                "name"
              ],
              "key_length": "163",
              "rows_examined_per_scan": 3,
              "rows_produced_per_join": 3,
              "filtered": "100.00",
              "using_index": true,
              "cost_info": {
                "read_cost": "0.25",
                "eval_cost": "0.30",
                "prefix_cost": "0.55",
                "data_read_per_join": "504"
              },
              "used_columns": [
                "name"
              ]
            }
          }
        },
        {
          "dependent": false,
          "cacheable": true,
          "query_block": {
            "select_id": 2,
            "cost_info": {
              "query_cost": "0.65"
            },
            "table": {
              "table_name": "pets",
              "access_type": "ALL",
              "rows_examined_per_scan": 4,
              "rows_produced_per_join": 4,
              "filtered": "100.00",
              "cost_info": {
                "read_cost": "0.25",
                "eval_cost": "0.40",
                "prefix_cost": "0.65",
                "data_read_per_join": "384"
              },
              "used_columns": [
                "kind"
              ]
            }
          }
        }
      ]
    }
  }
}

// A derived table, grouped, then sorted.
export const classicDerived = {
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "6.95"
    },
    "ordering_operation": {
      "using_filesort": true,
      "cost_info": {
        "sort_cost": "4.00"
      },
      "table": {
        "table_name": "d",
        "access_type": "ALL",
        "rows_examined_per_scan": 4,
        "rows_produced_per_join": 4,
        "filtered": "100.00",
        "cost_info": {
          "read_cost": "2.55",
          "eval_cost": "0.40",
          "prefix_cost": "2.95",
          "data_read_per_join": "96"
        },
        "used_columns": [
          "owner_id",
          "n"
        ],
        "materialized_from_subquery": {
          "using_temporary_table": true,
          "dependent": false,
          "cacheable": true,
          "query_block": {
            "select_id": 2,
            "cost_info": {
              "query_cost": "0.65"
            },
            "grouping_operation": {
              "using_filesort": false,
              "table": {
                "table_name": "pets",
                "access_type": "index",
                "possible_keys": [
                  "by_owner"
                ],
                "key": "by_owner",
                "used_key_parts": [
                  "owner_id"
                ],
                "key_length": "5",
                "rows_examined_per_scan": 4,
                "rows_produced_per_join": 4,
                "filtered": "100.00",
                "using_index": true,
                "cost_info": {
                  "read_cost": "0.25",
                  "eval_cost": "0.40",
                  "prefix_cost": "0.65",
                  "data_read_per_join": "384"
                },
                "used_columns": [
                  "id",
                  "owner_id"
                ]
              }
            }
          }
        }
      }
    }
  }
}

// A subquery in the select list, and one in the WHERE that MySQL answers before running.
export const classicSubqueries = {
  "query_block": {
    "select_id": 1,
    "cost_info": {
      "query_cost": "0.55"
    },
    "table": {
      "table_name": "o",
      "access_type": "index",
      "possible_keys": [
        "PRIMARY",
        "by_name"
      ],
      "key": "by_name",
      "used_key_parts": [
        "name"
      ],
      "key_length": "163",
      "rows_examined_per_scan": 3,
      "rows_produced_per_join": 2,
      "filtered": "66.67",
      "using_index": true,
      "cost_info": {
        "read_cost": "0.35",
        "eval_cost": "0.20",
        "prefix_cost": "0.55",
        "data_read_per_join": "336"
      },
      "used_columns": [
        "id",
        "name"
      ],
      "attached_condition": "(`explain probe`.`o`.`id` > (/* select#3 */ select min(`explain probe`.`pets`.`id`) from `explain probe`.`pets`))",
      "attached_subqueries": [
        {
          "dependent": false,
          "cacheable": true,
          "query_block": {
            "select_id": 3,
            "message": "Select tables optimized away"
          }
        }
      ]
    },
    "select_list_subqueries": [
      {
        "dependent": true,
        "cacheable": false,
        "query_block": {
          "select_id": 2,
          "cost_info": {
            "query_cost": "0.38"
          },
          "table": {
            "table_name": "p",
            "access_type": "ref",
            "possible_keys": [
              "by_owner"
            ],
            "key": "by_owner",
            "used_key_parts": [
              "owner_id"
            ],
            "key_length": "5",
            "ref": [
              "explain probe.o.id"
            ],
            "rows_examined_per_scan": 1,
            "rows_produced_per_join": 1,
            "filtered": "100.00",
            "using_index": true,
            "cost_info": {
              "read_cost": "0.25",
              "eval_cost": "0.13",
              "prefix_cost": "0.38",
              "data_read_per_join": "128"
            },
            "used_columns": [
              "owner_id"
            ]
          }
        }
      }
    ]
  }
}

// A single-table DELETE, which the classic format shows as the read that finds its rows.
export const classicDelete = {
  "query_block": {
    "select_id": 1,
    "table": {
      "delete": true,
      "table_name": "pets",
      "access_type": "range",
      "possible_keys": [
        "by_owner"
      ],
      "key": "by_owner",
      "used_key_parts": [
        "owner_id"
      ],
      "key_length": "5",
      "ref": [
        "const"
      ],
      "rows_examined_per_scan": 2,
      "filtered": "100.00",
      "attached_condition": "(`explain probe`.`pets`.`owner_id` = 1)"
    }
  }
}

// Real plans as EXPLAIN ANALYZE's tree, the text MySQL 8.0.18 – 8.2 gives, captured from
// MySQL 8.0 on the same tables.

// A join with an IN subquery, a GROUP BY and an ORDER BY.
export const treeJoin = [
  "-> Sort: `COUNT(*)` DESC  (actual time=0.156..0.156 rows=2 loops=1)",
  "    -> Table scan on <temporary>  (actual time=0.145..0.145 rows=2 loops=1)",
  "        -> Aggregate using temporary table  (actual time=0.144..0.144 rows=2 loops=1)",
  "            -> Nested loop inner join  (cost=1.92 rows=1) (actual time=0.0622..0.0704 rows=3 loops=1)",
  "                -> Hash semijoin (pets.owner_id = o.id)  (cost=1.07 rows=0.75) (actual time=0.0506..0.0534 rows=2 loops=1)",
  "                    -> Covering index scan on o using by_name  (cost=0.55 rows=3) (actual time=0.00799..0.00952 rows=3 loops=1)",
  "                    -> Hash",
  "                        -> Filter: (pets.kind = 'cat')  (cost=0.217 rows=1) (actual time=0.0244..0.0298 rows=2 loops=1)",
  "                            -> Table scan on pets  (cost=0.217 rows=4) (actual time=0.0223..0.0265 rows=4 loops=1)",
  "                -> Covering index lookup on p using by_owner (owner_id=o.id)  (cost=0.295 rows=1.33) (actual time=0.00611..0.0074 rows=1.5 loops=2)",
].join('\n')

// A UNION.
export const treeUnion = [
  "-> Table scan on <union temporary>  (cost=2.27..4.49 rows=7) (actual time=0.0736..0.0743 rows=6 loops=1)",
  "    -> Union materialize with deduplication  (cost=1.9..1.9 rows=7) (actual time=0.0726..0.0726 rows=6 loops=1)",
  "        -> Covering index scan on owners using by_name  (cost=0.55 rows=3) (actual time=0.0227..0.0269 rows=3 loops=1)",
  "        -> Table scan on pets  (cost=0.65 rows=4) (actual time=0.00549..0.00664 rows=4 loops=1)",
].join('\n')

// A derived table, grouped, then sorted.
export const treeDerived = [
  "-> Sort: d.n  (cost=4.18..4.18 rows=2) (actual time=0.06..0.0602 rows=3 loops=1)",
  "    -> Table scan on d  (cost=2.51..3.78 rows=2) (actual time=0.0482..0.049 rows=3 loops=1)",
  "        -> Materialize  (cost=1.25..1.25 rows=2) (actual time=0.0462..0.0462 rows=3 loops=1)",
  "            -> Group aggregate: count(0)  (cost=1.05 rows=2) (actual time=0.0294..0.0338 rows=3 loops=1)",
  "                -> Covering index scan on pets using by_owner  (cost=0.65 rows=4) (actual time=0.0248..0.0295 rows=4 loops=1)",
].join('\n')

// A subquery in the select list, which the tree puts beside its query.
export const treeSubquery = [
  "-> Covering index scan on o using by_name  (cost=0.55 rows=3) (actual time=0.0379..0.0409 rows=3 loops=1)",
  "-> Select #2 (subquery in projection; dependent)",
  "    -> Aggregate: count(0)  (cost=0.517 rows=1) (actual time=0.0132..0.0133 rows=1 loops=3)",
  "        -> Covering index lookup on p using by_owner (owner_id=o.id)  (cost=0.383 rows=1.33) (actual time=0.00865..0.011 rows=1.33 loops=3)",
].join('\n')

// A join whose outer table finds nothing, so its inner lookup never runs.
export const treeNeverExecuted = [
  "-> Nested loop inner join  (cost=0.817 rows=1.33) (actual time=0.0132..0.0132 rows=0 loops=1)",
  "    -> Covering index lookup on o using by_name (name='Nobody')  (cost=0.35 rows=1) (actual time=0.0125..0.0125 rows=0 loops=1)",
  "    -> Index lookup on p using by_owner (owner_id=o.id)  (cost=0.467 rows=1.33) (never executed)",
].join('\n')
