let pane:'primary'|'secondary'='primary';
export const focusNotesPane=(next:typeof pane)=>{pane=next;};
export const isNotesPaneActive=(next:typeof pane)=>pane===next;
