use super::{Record, RecordList, Stamp};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct Note {
    id: String,
    text: String,
    #[serde(flatten)]
    stamp: Stamp,
}

impl Record for Note {
    fn id(&self) -> &str {
        &self.id
    }

    fn stamp(&self) -> &Stamp {
        &self.stamp
    }

    fn restamp(&mut self, stamp: Stamp) {
        self.stamp = stamp;
    }

    fn emptied(&self) -> Self {
        Note { id: self.id.clone(), ..Note::default() }
    }
}

fn note(id: &str, text: &str, updated_at: i64) -> Note {
    Note { id: id.to_string(), text: text.to_string(), stamp: Stamp { updated_at, deleted: false } }
}

fn ids(notes: &[Note]) -> Vec<&str> {
    notes.iter().map(|n| n.id.as_str()).collect()
}

#[test]
fn put_stamps_the_record_with_the_current_time() {
    let before = crate::time::now_epoch_ms();
    let mut notes = Vec::new();
    notes.put(0, note("ä note.1", "first", 7));
    assert!(notes[0].stamp.updated_at >= before);
    assert!(!notes[0].stamp.deleted);
}

#[test]
fn put_inserts_at_the_given_position() {
    let mut notes = vec![note("a/1", "one", 1), note("b 2", "two", 2)];
    notes.put(0, note("front", "new", 3));
    notes.put(notes.len(), note("back", "new", 4));
    assert_eq!(ids(&notes), vec!["front", "a/1", "b 2", "back"]);
}

#[test]
fn edit_changes_the_record_and_stamps_it() {
    let mut notes = vec![note("ä note.1", "old", 7)];
    notes.edit("ä note.1", |n| n.text = String::from("new"));
    assert_eq!(notes[0].text, "new");
    assert!(notes[0].stamp.updated_at > 7);
}

#[test]
fn delete_marks_the_record_instead_of_removing_it() {
    let mut notes = vec![note("ä note.1", "text", 7), note("kept", "text", 7)];
    notes.delete_where(|n| n.id == "ä note.1");
    assert_eq!(notes.len(), 2);
    assert!(notes[0].stamp.deleted);
    assert!(notes[0].stamp.updated_at > 7);
    assert!(!notes[1].stamp.deleted);
    assert_eq!(notes[1].stamp.updated_at, 7);
}

#[test]
fn delete_keeps_only_the_id_and_the_stamp() {
    let mut notes = vec![note("ä note.1", "private text", 7)];
    notes.delete_where(|_| true);
    assert_eq!(notes[0].id, "ä note.1");
    assert_eq!(notes[0].text, "");
}

#[test]
fn deleting_a_tombstone_again_keeps_its_deletion_time() {
    let mut notes = vec![note("gone", "text", 7)];
    notes[0].stamp.deleted = true;
    notes.delete_where(|_| true);
    assert_eq!(notes[0].stamp.updated_at, 7);
}

#[test]
fn live_hides_deleted_records() {
    let mut notes = vec![note("gone", "text", 1), note("kept", "text", 1)];
    notes.delete_where(|n| n.id == "gone");
    assert_eq!(ids(&notes.live()), vec!["kept"]);
}

#[test]
fn edit_leaves_a_deleted_record_alone() {
    let mut notes = vec![note("gone", "old", 1)];
    notes.delete_where(|_| true);
    let deleted_at = notes[0].stamp.updated_at;
    notes.edit("gone", |n| n.text = String::from("new"));
    assert_eq!(notes[0].text, "");
    assert_eq!(notes[0].stamp.updated_at, deleted_at);
}

#[test]
fn recreating_a_deleted_id_replaces_its_tombstone_with_a_newer_live_record() {
    let mut notes = vec![note("same id", "old", 1)];
    notes.delete_where(|_| true);
    let deleted_at = notes[0].stamp.updated_at;
    notes.put(0, note("same id", "again", 1));
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].text, "again");
    assert!(!notes[0].stamp.deleted);
    assert!(notes[0].stamp.updated_at >= deleted_at);
}

#[test]
fn a_record_saved_before_stamps_existed_loads_as_live_and_older_than_any_edit() {
    let loaded: Note = serde_json::from_str(r#"{ "id": "old", "text": "from an old file" }"#).unwrap();
    assert!(!loaded.stamp.deleted);
    assert_eq!(loaded.stamp.updated_at, 0);
}

#[test]
fn the_stamp_is_written_alongside_the_record_fields() {
    let json = serde_json::to_value(note("x", "text", 42)).unwrap();
    assert_eq!(json["updated_at"], 42);
    assert_eq!(json["deleted"], false);
}
