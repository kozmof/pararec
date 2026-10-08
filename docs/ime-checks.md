# Native IME checks

Run these checks on macOS with Japanese input and on Windows with Microsoft Japanese IME. Browser composition-event tests cover application behavior, but they do not exercise an operating system's input method or candidate window.

Record the operating system, browser version, input method, date, commit, and result for each check. Use Chromium and Safari on macOS, and Chromium on Windows. Use a disposable document.

1. Start `pararec serve` and open the pad. Focus a right note, enter Japanese text, and select a candidate. Confirm that the text appears once, save it, and reload.
2. Press Enter while choosing a candidate. Confirm that it commits the candidate without inserting an extra newline or creating a row. Try Alt+Enter and Ctrl+Enter during composition and confirm that neither changes structure.
3. Narrow the browser until the note wraps. Start composition near a wrap boundary and extend the preedit across it. Confirm that the candidate window follows the caret and that the committed text wraps without losing or duplicating characters.
4. Select existing text and replace it with Japanese composition. Undo once and confirm that the original text and caret return. Redo and confirm that the replacement returns once.
5. Start composition and move focus to another note. Confirm that uncommitted preedit is cancelled and the saved document contains only committed text.
6. Start composition and press Ctrl+S or the platform's save shortcut. Confirm that preedit is not written. Commit the composition, save, and reload to verify the committed text.

These checks require a person using the native input method. Record pending checks as pending rather than treating synthetic composition events as a native IME result.
