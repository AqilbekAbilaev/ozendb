use crate::error::AppError;
use serde::Serialize;
use tauri::State;

use super::AppContext;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgIndexStats {
    pub name: String,
    pub size_bytes: i64,
    /// How many index scans have used it since the stats were last reset — the
    /// "is this index earning its keep" signal, as MongoDB's `index_stats` gives.
    pub scans: i64,
    pub primary_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgTableStats {
    /// Heap, indexes and TOAST together — what the table costs on disk.
    pub total_size_bytes: i64,
    /// The heap alone, so the split between data and indexes is visible.
    pub table_size_bytes: i64,
    pub indexes_size_bytes: i64,
    /// The planner's estimate, as the tree already shows. None for a table never
    /// vacuumed or analysed (`reltuples` is -1 there), never a guess of our own.
    pub estimated_rows: Option<i64>,
    /// Row versions left behind by updates and deletes: the cheapest bloat signal
    /// there is, and the reason a table can be far bigger than its row count.
    pub dead_rows: i64,
    /// Timestamps as text rather than a typed datetime: they are shown, never
    /// computed with, and this avoids a chrono feature on sqlx for two fields.
    /// Manual and autovacuum are folded together — whichever ran last is the
    /// answer to "when was this table last vacuumed".
    pub last_vacuum: Option<String>,
    pub last_analyze: Option<String>,
    pub indexes: Vec<PgIndexStats>,
}

pub(crate) async fn table_stats_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<PgTableStats, AppError> {
    let row: Option<(i64, i64, i64, Option<f32>, i64, Option<String>, Option<String>)> =
        match sqlx::query_as(
            "SELECT pg_total_relation_size(c.oid), pg_relation_size(c.oid), pg_indexes_size(c.oid), \
                    c.reltuples, COALESCE(s.n_dead_tup, 0), \
                    GREATEST(s.last_vacuum, s.last_autovacuum)::text, \
                    GREATEST(s.last_analyze, s.last_autoanalyze)::text \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid \
             WHERE n.nspname = $1 AND c.relname = $2",
        )
        .bind(schema)
        .bind(table)
        .fetch_optional(pool)
        .await
        {
            Ok(val) => val,
            Err(e) => return Err(AppError::Postgres(e)),
        };

    // A name that resolves to nothing is a caller error, not an empty reading:
    // reporting zeroes would read as "an empty table" for a table that isn't there.
    let (total, heap, indexes_size, reltuples, dead_rows, last_vacuum, last_analyze) = match row {
        Some(val) => val,
        None => {
            return Err(AppError::Validation(format!(
                "No table or view named \"{schema}\".\"{table}\"."
            )))
        }
    };

    let indexes: Vec<(String, i64, i64, bool)> = match sqlx::query_as(
        "SELECT i.relname, pg_relation_size(i.oid), COALESCE(s.idx_scan, 0), x.indisprimary \
         FROM pg_index x \
         JOIN pg_class i ON i.oid = x.indexrelid \
         JOIN pg_class t ON t.oid = x.indrelid \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         LEFT JOIN pg_stat_all_indexes s ON s.indexrelid = i.oid \
         WHERE n.nspname = $1 AND t.relname = $2 \
         ORDER BY x.indisprimary DESC, i.relname",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };

    Ok(PgTableStats {
        total_size_bytes: total,
        table_size_bytes: heap,
        indexes_size_bytes: indexes_size,
        estimated_rows: reltuples.filter(|&n| n >= 0.0).map(|n| n as i64),
        dead_rows,
        last_vacuum,
        last_analyze,
        indexes: indexes
            .into_iter()
            .map(|(name, size_bytes, scans, primary_key)| PgIndexStats {
                name,
                size_bytes,
                scans,
                primary_key,
            })
            .collect(),
    })
}

/// On-disk size of one table, its indexes and their usage — the Postgres sibling
/// of MongoDB's `collection_stats`. Reads `pg_catalog` and the `pg_stat_*` views
/// only, so it needs no extension and no special privilege.
#[tauri::command]
pub async fn pg_table_stats(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    table: String,
) -> Result<PgTableStats, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    table_stats_impl(&pool, &schema, &table).await
}
