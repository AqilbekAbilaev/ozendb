use super::*;

#[test]
fn a_noted_edit_wakes_a_receiver_subscribed_before_it() {
    let mut edits = subscribe();
    edits.borrow_and_update();
    note();
    assert!(edits.has_changed().unwrap());
}
