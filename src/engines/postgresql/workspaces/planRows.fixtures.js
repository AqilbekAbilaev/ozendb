// A real EXPLAIN (ANALYZE, FORMAT JSON) of a join with a GROUP BY and ORDER BY, captured
// from PostgreSQL 16 — the shape planRows reads.
export const joinPlan = [
  {
    "Plan": {
      "Node Type": "Sort",
      "Parallel Aware": false,
      "Async Capable": false,
      "Startup Cost": 5.8,
      "Total Cost": 5.8,
      "Plan Rows": 1,
      "Plan Width": 10,
      "Actual Startup Time": 0.115,
      "Actual Total Time": 0.116,
      "Actual Rows": 1,
      "Actual Loops": 1,
      "Sort Key": [
        "(count(*)) DESC"
      ],
      "Sort Method": "quicksort",
      "Sort Space Used": 25,
      "Sort Space Type": "Memory",
      "Plans": [
        {
          "Node Type": "Aggregate",
          "Strategy": "Hashed",
          "Partial Mode": "Simple",
          "Parent Relationship": "Outer",
          "Parallel Aware": false,
          "Async Capable": false,
          "Startup Cost": 5.78,
          "Total Cost": 5.79,
          "Plan Rows": 1,
          "Plan Width": 10,
          "Actual Startup Time": 0.09,
          "Actual Total Time": 0.091,
          "Actual Rows": 1,
          "Actual Loops": 1,
          "Group Key": [
            "a.v"
          ],
          "Planned Partitions": 0,
          "HashAgg Batches": 1,
          "Peak Memory Usage": 24,
          "Disk Usage": 0,
          "Plans": [
            {
              "Node Type": "Hash Join",
              "Parent Relationship": "Outer",
              "Parallel Aware": false,
              "Async Capable": false,
              "Join Type": "Inner",
              "Startup Cost": 1.85,
              "Total Cost": 5.42,
              "Plan Rows": 72,
              "Plan Width": 2,
              "Actual Startup Time": 0.037,
              "Actual Total Time": 0.071,
              "Actual Rows": 76,
              "Actual Loops": 1,
              "Inner Unique": true,
              "Hash Cond": "(b.a_id = a.id)",
              "Plans": [
                {
                  "Node Type": "Seq Scan",
                  "Parent Relationship": "Outer",
                  "Parallel Aware": false,
                  "Async Capable": false,
                  "Relation Name": "b",
                  "Alias": "b",
                  "Startup Cost": 0.0,
                  "Total Cost": 3.0,
                  "Plan Rows": 200,
                  "Plan Width": 4,
                  "Actual Startup Time": 0.008,
                  "Actual Total Time": 0.018,
                  "Actual Rows": 200,
                  "Actual Loops": 1
                },
                {
                  "Node Type": "Hash",
                  "Parent Relationship": "Inner",
                  "Parallel Aware": false,
                  "Async Capable": false,
                  "Startup Cost": 1.62,
                  "Total Cost": 1.62,
                  "Plan Rows": 18,
                  "Plan Width": 6,
                  "Actual Startup Time": 0.015,
                  "Actual Total Time": 0.015,
                  "Actual Rows": 19,
                  "Actual Loops": 1,
                  "Hash Buckets": 1024,
                  "Original Hash Buckets": 1024,
                  "Hash Batches": 1,
                  "Original Hash Batches": 1,
                  "Peak Memory Usage": 9,
                  "Plans": [
                    {
                      "Node Type": "Seq Scan",
                      "Parent Relationship": "Outer",
                      "Parallel Aware": false,
                      "Async Capable": false,
                      "Relation Name": "a",
                      "Alias": "a",
                      "Startup Cost": 0.0,
                      "Total Cost": 1.62,
                      "Plan Rows": 18,
                      "Plan Width": 6,
                      "Actual Startup Time": 0.004,
                      "Actual Total Time": 0.009,
                      "Actual Rows": 19,
                      "Actual Loops": 1,
                      "Filter": "(id < 20)",
                      "Rows Removed by Filter": 31
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    "Planning Time": 0.582,
    "Triggers": [],
    "Execution Time": 0.204
  }
]
