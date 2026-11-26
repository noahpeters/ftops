import { useRef, useState, type FormEvent } from "react";
import * as stylex from "@stylexjs/stylex";
import { Button, IconButton, Select, Status, Switch, TextArea, TextInput } from "@from-trees/ui";
import { gap, layout } from "@from-trees/ui/utilities";
import { DateTime } from "luxon";
import type { WorkspaceUser } from "../users/api";

const maxFileSize = 100 * 1024 * 1024;
export const customerTimeZone = "America/Los_Angeles";

export type CustomerNoteInput = {
  subject: string;
  body: string;
  followUpAt?: string;
  followUpDescription?: string;
  followUpAssignedTo?: string;
  files: File[];
};

export function CustomerNoteForm({
  id,
  onSave,
  saving,
  users,
  saveError,
}: {
  id: string;
  onSave: (input: CustomerNoteInput) => Promise<void>;
  saving: boolean;
  users: WorkspaceUser[];
  saveError: string | null;
}) {
  const [subject, setSubject] = useState("Note");
  const [body, setBody] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [due, setDue] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [validationError, setValidationError] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!subject.trim() || !body.trim() || (schedule && !description.trim())) {
      setValidationError(
        "Enter the note title and body, and a description if scheduling a follow-up."
      );
      return;
    }
    const followUp = schedule ? DateTime.fromISO(due, { zone: customerTimeZone }) : undefined;
    if (followUp && (!followUp.isValid || followUp.toFormat("yyyy-MM-dd'T'HH:mm") !== due)) {
      setValidationError("Choose a valid follow-up date and time in Pacific time.");
      return;
    }
    setValidationError("");
    void onSave({
      subject: subject.trim(),
      body: body.trim(),
      followUpAt: followUp?.toUTC().toISO() ?? undefined,
      followUpDescription: schedule ? description.trim() : undefined,
      followUpAssignedTo: schedule ? assignee || undefined : undefined,
      files,
    });
  }

  return (
    <form id={id} onSubmit={submit} {...stylex.props(layout.stack, gap.lg)}>
      {saveError && <Status tone="danger">{saveError}</Status>}
      {validationError && <Status tone="danger">{validationError}</Status>}
      <TextInput
        label="Note title"
        required
        disabled={saving}
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
      />
      <TextArea
        label="Note body"
        help="Markdown supports headings, lists, links, bold, italic, and code."
        required
        disabled={saving}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div {...stylex.props(layout.stack, gap.md)}>
        <Switch
          label="Schedule follow-up"
          selected={schedule}
          onChange={setSchedule}
          disabled={saving}
        />
        {schedule && (
          <>
            <TextInput
              label="Due date and time"
              help="Pacific time"
              type="datetime-local"
              required
              disabled={saving}
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
            <TextInput
              label="Follow-up description"
              required
              disabled={saving}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <Select
              label="Assignee"
              disabled={saving}
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </Select>
          </>
        )}
      </div>
      <div {...stylex.props(layout.stack, gap.sm)}>
        <div>
          <Button icon="add" isDisabled={saving} onPress={() => picker.current?.click()}>
            Attach files
          </Button>
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Choose files to attach"
          disabled={saving}
          onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? []);
            const invalid = selected.filter((file) => file.size < 1 || file.size > maxFileSize);
            setFileError(
              invalid.length
                ? `Could not add ${invalid.map((file) => file.name).join(", ")}. Files must be nonempty and 100 MB or smaller.`
                : ""
            );
            setFiles((current) => [
              ...current,
              ...selected.filter((file) => !invalid.includes(file)),
            ]);
            event.currentTarget.value = "";
          }}
        />
        {fileError && <Status tone="danger">{fileError}</Status>}
        <div aria-live="polite">
          {files.length} {files.length === 1 ? "file" : "files"} attached.
        </div>
        {files.length > 0 && (
          <ul aria-label="Attached files">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.lastModified}-${index}`}>
                <div {...stylex.props(layout.row, layout.wrap, layout.alignCenter, gap.sm)}>
                  <span>{file.name}</span>
                  <IconButton
                    icon="close"
                    label={`Remove ${file.name}`}
                    isDisabled={saving}
                    onPress={() =>
                      setFiles((current) => current.filter((_, item) => item !== index))
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
