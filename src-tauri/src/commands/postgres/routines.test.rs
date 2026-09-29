use super::kind_of;

// The listing labels a routine from `prokind`, and the frontend branches on that
// label — so the mapping is worth pinning without a server.
#[test]
fn prokind_p_is_a_procedure() {
    assert_eq!(kind_of("p"), "procedure");
}

#[test]
fn prokind_f_is_a_function() {
    assert_eq!(kind_of("f"), "function");
}

// Aggregates and window functions are filtered out by the query, so nothing should
// reach this — but if the filter ever loosens, "function" is the safe reading: it
// keeps the row visible rather than inventing a kind the frontend can't render.
#[test]
fn anything_else_reads_as_a_function() {
    assert_eq!(kind_of("a"), "function");
    assert_eq!(kind_of("w"), "function");
}
