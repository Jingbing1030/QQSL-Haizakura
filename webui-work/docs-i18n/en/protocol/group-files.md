# Sending group files and temporary storage


The file segments in `upload_group_file` and `send_group_msg` use the group's permanent file space by default.
When the server explicitly reports a capacity or file-count limit, Haizakura attempts temporary storage once and records the switch in the log.
A failed temporary request, file transfer, or chat post still raises an error; other failures such as insufficient permissions or a dropped connection do not trigger the switch.
Temporary files can expire and are not a substitute for permanent storage.

## Message content limits

On the temporary-file path, a single message may contain only file or image segments.
Mixed messages carrying text, mentions, faces, or other content are rejected, and the caller must split them into separate messages.
Combined forwards are checked against the same rule for each node's content.

Haizakura inspects attachments before posting a chat message; when it finds a disallowed combination it does not send the text first and then drop the attachment or the text.
Other attachment uploads completed before the check are not deleted automatically. If the chat post fails after a successful upload, the error still carries the file identifier.
This is not a transaction spanning several messages: network or server errors that occur after posting begins may still leave earlier messages delivered.

An ordinary image with text still goes out through the image message channel and does not become a group file merely because the permanent file space is full.
The existing separate delivery of permanent files and text stays compatible. Oversized videos are converted to files under the existing rules and are then subject to the temporary-file content limits as well.

## File reuse and download

A group file uploaded during the current run keeps its storage type, keyed by account, group, and file identifier.
Sending the same `file_id` again in that group, fetching a download link, or building a combined forward uses that storage type.
A `busid` passed explicitly to `get_group_file_url` still takes precedence; when no valid value is given, the type remembered for the current session is used, otherwise the permanent-file default applies.
The upload record is not a persistent directory; to fetch a temporary file link after a restart, read the corresponding `busid` from the group file list and pass it in.
