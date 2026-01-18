type PayloadEditorProps = {
  payloadText: string;
  onChange: (value: string) => void;
};

export function PayloadEditor({ payloadText, onChange }: PayloadEditorProps): JSX.Element {
  return (
    <div className="payload-editor">
      <label className="full">
        Advanced: Edit Payload
        <textarea rows={8} value={payloadText} onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}
