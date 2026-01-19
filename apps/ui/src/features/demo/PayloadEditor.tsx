import stylex from "~/lib/stylex";

type PayloadEditorProps = {
  payloadText: string;
  onChange: (value: string) => void;
};

const styles = stylex.create({
  editor: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  full: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
});

export function PayloadEditor({ payloadText, onChange }: PayloadEditorProps): JSX.Element {
  return (
    <div className={stylex(styles.editor)}>
      <label className={stylex(styles.full)}>
        Advanced: Edit Payload
        <textarea rows={8} value={payloadText} onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}
