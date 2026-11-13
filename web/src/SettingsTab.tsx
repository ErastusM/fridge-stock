import { useRef, useState } from 'react';
import { emptyData, fmtDateTime, parseData, sampleData, type Data } from './model';
import { Button, ErrorLine, Field, inputCls, Modal, download, useCtx, useFormError } from './ui';

export function backupNow(data: Data, update: (c: (d: Data) => Data) => void) {
  const at = new Date();
  const stamp = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  const withStamp: Data = { ...data, settings: { ...data.settings, lastBackupAt: at.toISOString() } };
  download(`fridge-backup-${stamp}.json`, JSON.stringify(withStamp, null, 1), 'application/json');
  update((d) => ({ ...d, settings: { ...d.settings, lastBackupAt: at.toISOString() } }));
}

export function SettingsTab() {
  const { data, update, toast } = useCtx();
  const [name, setName] = useState(data.settings.fridgeName);
  const [day, setDay] = useState(String(data.settings.monthStartDay));
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: () => void; word?: string }>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { error, run } = useFormError();
  const isEmpty = data.people.length === 0 && data.items.length === 0 && data.entries.length === 0;

  const saveSettings = () =>
    run(() => {
      const n = name.trim();
      const dd = Number(day);
      if (!n) throw new Error('Give the fridge a name.');
      if (!Number.isInteger(dd) || dd < 1 || dd > 28) throw new Error('The month start day must be 1 to 28.');
      update((d) => ({ ...d, settings: { ...d.settings, fridgeName: n, monthStartDay: dd } }));
      toast('Settings saved');
    });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const restored = parseData(JSON.parse(await f.text()));
      setConfirm({
        title: 'Restore this backup?',
        body: `It has ${restored.people.length} people, ${restored.items.length} items and ${restored.entries.length} records. Everything on this device now is replaced by it.`,
        action: () => {
          update(() => restored);
          toast('Backup restored');
        },
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="max-w-xl space-y-8">
      <section className="space-y-3">
        <h2 className="text-xl font-black text-navy-900">Settings</h2>
        <Field label="Fridge name" hint="Shown on the top bar and on printed reports.">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="The report month starts on day" hint="1 = calendar month. 16 = the 16th to the 15th, named after the month it ends in.">
          <input className={inputCls} inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <ErrorLine text={error} />
        <Button kind="primary" onClick={saveSettings}>
          Save settings
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-black text-navy-900">Backup</h2>
        <p className="text-navy-700">
          The records are kept on this device. Download a backup now and then (once a month, after the report, is a good habit) and
          keep it on OneDrive or e-mail. It also moves the records to a new computer.
        </p>
        <p className="text-sm text-navy-600">
          Last backup: {data.settings.lastBackupAt ? fmtDateTime(new Date(data.settings.lastBackupAt)) : 'never'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" onClick={() => backupNow(data, update)}>
            Download backup
          </Button>
          <Button onClick={() => fileRef.current?.click()}>Restore a backup…</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-black text-navy-900">Try it out</h2>
        <p className="text-navy-700">Fill the app with five sample people, nine drinks and a few takes, to see how it works.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              isEmpty
                ? (update(() => sampleData(new Date())), toast('Sample data loaded'))
                : setConfirm({
                    title: 'Replace everything with sample data?',
                    body: 'All people, items and records on this device are replaced by the sample.',
                    action: () => {
                      update(() => sampleData(new Date()));
                      toast('Sample data loaded');
                    },
                  })
            }
          >
            Load sample data
          </Button>
          <Button
            kind="danger"
            disabled={isEmpty}
            onClick={() =>
              setConfirm({
                title: 'Erase everything?',
                body: 'All people, items and records on this device are deleted. Download a backup first if you may need them.',
                word: 'ERASE',
                action: () => {
                  update(() => emptyData());
                  toast('Everything erased');
                },
              })
            }
          >
            Erase everything
          </Button>
        </div>
      </section>

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function ConfirmDialog({ title, body, action, word, onClose }: { title: string; body: string; action: () => void; word?: string; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <p className="mb-4 text-navy-700">{body}</p>
      {word && (
        <div className="mb-4">
          <Field label={`Type ${word} to confirm`}>
            <input className={inputCls} autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          kind="primary"
          disabled={!!word && typed.trim().toUpperCase() !== word}
          onClick={() => {
            action();
            onClose();
          }}
        >
          Yes, go ahead
        </Button>
      </div>
    </Modal>
  );
}
