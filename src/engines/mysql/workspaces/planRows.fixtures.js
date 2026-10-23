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
