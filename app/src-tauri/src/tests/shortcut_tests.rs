use crate::normalize_shortcut_string;

#[test]
fn test_normalize_ctrl_to_control() {
    assert_eq!(normalize_shortcut_string("Ctrl+Space"), "control+space");
}

#[test]
fn test_normalize_uppercase_ctrl() {
    assert_eq!(normalize_shortcut_string("CTRL+A"), "control+a");
}

#[test]
fn test_normalize_cmd_to_super() {
    assert_eq!(normalize_shortcut_string("cmd+shift+a"), "super+shift+a");
}

#[test]
fn test_normalize_win_to_super() {
    assert_eq!(normalize_shortcut_string("WIN+a"), "super+a");
}

#[test]
fn test_normalize_meta_to_super() {
    assert_eq!(normalize_shortcut_string("Meta+b"), "super+b");
}

#[test]
fn test_normalize_multiple_replacements() {
    // ctrl+meta should become control+super
    assert_eq!(normalize_shortcut_string("ctrl+meta+x"), "control+super+x");
}

#[test]
fn test_normalize_already_normalized() {
    assert_eq!(
        normalize_shortcut_string("control+alt+space"),
        "control+alt+space"
    );
}

#[test]
fn test_normalize_preserves_non_modifier_parts() {
    assert_eq!(
        normalize_shortcut_string("ctrl+Backquote"),
        "control+backquote"
    );
}

#[test]
fn test_normalize_empty_string() {
    assert_eq!(normalize_shortcut_string(""), "");
}

#[test]
fn test_normalize_single_key() {
    assert_eq!(normalize_shortcut_string("Space"), "space");
}
