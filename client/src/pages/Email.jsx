import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { sendReportEmail } from '../lib/api';
import { PC_HSD_EMAIL } from '../lib/constants';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_SUBJECT = 'Weekly Zetwerk MIS and Department Performance Report- Week 34 from (17-08-26) to (23-08-26).';

// Each upload slot is a non-editable "island" inside the rich-text body: clicking it,
// pressing Enter/Space on it, or dragging an image file onto it opens/accepts a file (see
// handleBodyClick/handleBodyKeyDown/handleBodyDrop), and the chosen image replaces the
// placeholder in place. Being contenteditable="false" keeps it from being typed into while
// the surrounding report text stays fully editable.
function uploadBoxHtml() {
  return `<div class="upload-box" data-upload-box contenteditable="false" role="button" tabindex="0" aria-label="Upload image"
      style="margin:8px 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:130px;border:2px dashed var(--baseline);border-radius:10px;cursor:pointer;background:var(--surface-1);color:var(--text-secondary);font-size:13px;font-weight:500;text-align:center;transition:border-color .15s,background .15s;">
    <span style="font-size:20px;">📁</span>
    <span>Drag &amp; drop an image, or click to upload</span>
  </div>`;
}

// A "line" is a piece of fixed report text with a small pencil icon at the end; clicking
// the icon selects that line's text so the process coordinator can type over it immediately,
// without needing a formatting toolbar or hunting for where the editable text starts.
function reportLineHtml(innerHtml, extraStyle = '') {
  return `<p class="report-line" data-line style="${extraStyle}">
    <span class="line-text">${innerHtml}</span>
    <button type="button" data-edit-line contenteditable="false" aria-label="Edit this line" title="Edit text"
        style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-left:4px;border:none;background:transparent;cursor:pointer;font-size:13px;line-height:1;vertical-align:middle;opacity:.55;">✏️</button>
  </p>`;
}

function workerRowHtml(number, sample) {
  return `${reportLineHtml(`${number}. ${sample}`, 'margin:10px 0 0;')}${uploadBoxHtml()}`;
}

const SAMPLE_WORKERS = [
  '[ Worker Name ] (Project- ___ - Tasks)',
  'Jagdeesh Kumar (Project- Solar, Swage Pole - Tacking, Welding, Rolling, Punching, Cutting)',
  'Ram Milan (Project- Indus GBM - Welding, Rolling, Tacking)',
  'Sunil Tomar (Project- Solar - Rolling)',
  'Bharat Rai (Project- Solar - Punching, Welding, Tacking, Cutting)',
];

const SIGNATURE_HTML = `
  <div id="email-signature" contenteditable="false" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--baseline);">
    <table style="border-collapse:collapse;"><tr>
      <td style="vertical-align:top;padding-right:16px;">
        <img src="/salasar-bg.png" alt="Salasar Techno Engineering Ltd." style="height:56px;width:auto;display:block;" />
      </td>
      <td style="vertical-align:top;border-left:2px solid #dc1f2b;padding-left:16px;font-size:13px;line-height:1.5;color:var(--text-primary);">
        <div style="font-weight:700;">Vikrant Kumar</div>
        <div style="color:var(--text-secondary);">Process Coordinator - Heavy Structure Division</div>
        <div style="margin-top:4px;">+91 6397595412</div>
        <div><a href="mailto:pc.hsd@salasartechno.com" style="color:var(--series-1);">pc.hsd@salasartechno.com</a></div>
        <div style="margin-top:4px;color:var(--text-secondary);">Khasra No - 686/6, Village - Khera, P.O. Pilkhuwa, District Hapur (UP) Pin - 245304, India,</div>
        <div><a href="https://www.salasartechno.com" style="color:var(--series-1);">www.salasartechno.com</a></div>
        <div style="margin-top:8px;">
          <a href="#" aria-label="Facebook" style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:9999px;background:#dc1f2b;color:#fff;font-size:11px;font-weight:700;text-decoration:none;margin-right:6px;">f</a>
          <a href="#" aria-label="LinkedIn" style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:9999px;background:#dc1f2b;color:#fff;font-size:11px;font-weight:700;text-decoration:none;margin-right:6px;">in</a>
          <a href="#" aria-label="Twitter" style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:9999px;background:#dc1f2b;color:#fff;font-size:11px;font-weight:700;text-decoration:none;">t</a>
        </div>
      </td>
    </tr></table>
    <div style="margin-top:12px;padding:10px;text-align:center;background:var(--surface-2);border-radius:6px;">
      <div style="font-weight:700;font-size:12px;color:var(--text-primary);">SALASAR TECHNO ENGINEERING LTD.</div>
      <div style="font-size:11px;color:var(--text-secondary);">ISO 9001 : 2015, ISO 14001 : 2015, ISO 45001 : 2018</div>
    </div>
  </div>
`;

const DEFAULT_BODY = `
  <p>Dear Production Head,</p>
  <p>Please find attached the Weekly performance for your department, please check and review,</p>
  ${reportLineHtml('<strong>1. MIS Production Department Report,</strong>', 'margin-top:12px;')}
  ${uploadBoxHtml()}
  ${reportLineHtml('<strong>2. Full department performance,</strong>')}
  ${uploadBoxHtml()}
  <div id="worker-list">
    ${SAMPLE_WORKERS.map((w, i) => workerRowHtml(i + 1, w)).join('\n')}
  </div>
  ${SIGNATURE_HTML}
`;

// One consistent focus-visible treatment, reused everywhere in this page instead of a
// per-component exception, per the "no one-off styling" rule.
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--series-1)]';

function RecipientField({ label, values, onChange, placeholder, disabled }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const inputId = `recipient-${label.toLowerCase()}`;
  const errorId = `${inputId}-error`;

  function addFromDraft() {
    const candidate = draft.trim().replace(/,$/, '');
    if (!candidate) return;
    if (!EMAIL_PATTERN.test(candidate)) {
      setError('Not a valid email address');
      return;
    }
    if (values.includes(candidate)) {
      setDraft('');
      setError('');
      return;
    }
    onChange([...values, candidate]);
    setDraft('');
    setError('');
  }

  function remove(email) {
    if (disabled) return;
    onChange(values.filter((v) => v !== email));
  }

  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <label htmlFor={inputId} className="w-full shrink-0 pt-2 text-xs font-semibold uppercase tracking-wide sm:w-16" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      <div className="min-w-0 flex-1">
        <div
          className="flex flex-wrap items-center gap-1.5 rounded-lg border p-2"
          style={{ background: 'var(--surface-2)', borderColor: error ? 'var(--status-critical)' : undefined, opacity: disabled ? 0.6 : 1 }}
        >
          {values.map((email) => (
            <span
              key={email}
              title={email}
              className="flex max-w-[240px] items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              style={{ background: 'var(--surface-1)', color: 'var(--text-primary)' }}
            >
              <span className="truncate">{email}</span>
              <button
                type="button"
                onClick={() => remove(email)}
                disabled={disabled}
                aria-label={`Remove ${email}`}
                className={`shrink-0 rounded-sm leading-none transition-colors hover:text-[var(--status-critical)] disabled:cursor-not-allowed ${FOCUS_RING}`}
                style={{ color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </span>
          ))}
          <input
            id={inputId}
            type="text"
            value={draft}
            disabled={disabled}
            aria-label={`${label} recipient email`}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addFromDraft();
              } else if (e.key === 'Backspace' && !draft && values.length) {
                remove(values[values.length - 1]);
              }
            }}
            onBlur={addFromDraft}
            placeholder={values.length ? 'Add another…' : placeholder}
            className={`min-w-[140px] flex-1 rounded bg-transparent text-sm disabled:cursor-not-allowed ${FOCUS_RING}`}
            style={{ color: 'var(--text-primary)' }}
          />
        </div>
        {error && (
          <div id={errorId} role="alert" className="mt-1 text-xs" style={{ color: 'var(--status-critical)' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export function Email() {
  const [to, setTo] = useState(['ambeydeep8052@gmail.com']);
  const [cc, setCc] = useState(['ea.hsd@salasartechno.com']);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [errorMessage, setErrorMessage] = useState('');
  const bodyRef = useRef(null);
  const boxFileInputRef = useRef(null);
  const pendingBoxRef = useRef(null);
  const sending = status === 'sending';

  function applyImageToBox(box, file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      box.innerHTML = `<img src="${reader.result}" alt="Uploaded image" style="max-width:100%;max-height:260px;display:block;border-radius:8px;margin:0 auto;" />`;
      box.style.border = 'none';
      box.style.background = 'transparent';
      box.style.height = 'auto';
      box.style.padding = '0';
    };
    reader.readAsDataURL(file);
  }

  function openBoxPicker(box) {
    if (sending) return;
    pendingBoxRef.current = box;
    boxFileInputRef.current?.click();
  }

  function selectLineText(editBtn) {
    const line = editBtn.closest('[data-line]');
    const textEl = line?.querySelector('.line-text');
    if (!textEl || !bodyRef.current) return;
    bodyRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function handleBodyClick(e) {
    if (sending) return;
    const box = e.target.closest('[data-upload-box]');
    if (box) {
      openBoxPicker(box);
      return;
    }
    const editBtn = e.target.closest('[data-edit-line]');
    if (editBtn) selectLineText(editBtn);
  }

  function handleBodyKeyDown(e) {
    if (sending) return;
    const box = e.target.closest('[data-upload-box]');
    if (box && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openBoxPicker(box);
      return;
    }
    const editBtn = e.target.closest('[data-edit-line]');
    if (editBtn && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      selectLineText(editBtn);
    }
  }

  function handleBodyDragOver(e) {
    const box = e.target.closest('[data-upload-box]');
    if (!box || sending) return;
    e.preventDefault();
    box.style.borderColor = 'var(--series-1)';
    box.style.background = 'var(--surface-2)';
  }

  function handleBodyDragLeave(e) {
    const box = e.target.closest('[data-upload-box]');
    if (!box) return;
    if (box.contains(e.relatedTarget)) return;
    box.style.borderColor = '';
    box.style.background = '';
  }

  function handleBodyDrop(e) {
    const box = e.target.closest('[data-upload-box]');
    if (!box || sending) return;
    e.preventDefault();
    box.style.borderColor = '';
    box.style.background = '';
    applyImageToBox(box, e.dataTransfer.files?.[0]);
  }

  function handleBoxFileChange(e) {
    const file = e.target.files?.[0];
    const box = pendingBoxRef.current;
    e.target.value = '';
    if (file && box) applyImageToBox(box, file);
  }

  async function handleSend(e) {
    e.preventDefault();
    const bodyHtml = bodyRef.current?.innerHTML || '';
    if (to.length === 0) {
      setStatus('error');
      setErrorMessage('Add at least one "To" recipient.');
      return;
    }
    if (!subject.trim()) {
      setStatus('error');
      setErrorMessage('Subject is required.');
      return;
    }

    setStatus('sending');
    setErrorMessage('');
    try {
      await sendReportEmail({ to, cc, subject, bodyHtml });
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err?.response?.data?.error || 'Failed to send email. Please try again.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        Email
      </h1>

      <form onSubmit={handleSend} className="rounded-2xl border" style={{ background: 'var(--surface-1)' }}>
        <div className="space-y-3 border-b p-4 sm:p-5" style={{ borderColor: 'var(--baseline)' }}>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span id="from-label" className="w-full shrink-0 text-xs font-semibold uppercase tracking-wide sm:w-16" style={{ color: 'var(--text-muted)' }}>
              From
            </span>
            <div role="textbox" aria-readonly="true" aria-labelledby="from-label" className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
              {PC_HSD_EMAIL}
            </div>
          </div>

          <RecipientField label="To" values={to} onChange={setTo} placeholder="Add recipient email…" disabled={sending} />
          <RecipientField label="CC" values={cc} onChange={setCc} placeholder="Add CC email…" disabled={sending} />

          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <label htmlFor="email-subject" className="w-full shrink-0 text-xs font-semibold uppercase tracking-wide sm:w-16" style={{ color: 'var(--text-muted)' }}>
              Subject
            </label>
            <input
              id="email-subject"
              type="text"
              required
              value={subject}
              disabled={sending}
              onChange={(e) => setSubject(e.target.value)}
              className={`flex-1 rounded-lg border-0 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
              style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <input
            ref={boxFileInputRef}
            type="file"
            accept="image/*"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleBoxFileChange}
          />

          <div
            id="email-body"
            ref={bodyRef}
            contentEditable={!sending}
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: DEFAULT_BODY }}
            role="textbox"
            aria-multiline="true"
            aria-label="Email body"
            data-placeholder="Write your report…"
            onClick={handleBodyClick}
            onKeyDown={handleBodyKeyDown}
            onDragOver={handleBodyDragOver}
            onDragLeave={handleBodyDragLeave}
            onDrop={handleBodyDrop}
            className={`min-h-[280px] w-full rounded-lg border p-4 text-sm leading-relaxed disabled:cursor-not-allowed empty:before:italic empty:before:text-[var(--text-muted)] empty:before:content-[attr(data-placeholder)] [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_img]:my-2 [&_img]:max-w-full [&_li]:ml-4 [&_p]:mb-2 [&_ul]:list-disc ${FOCUS_RING}`}
            style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', borderColor: 'var(--baseline)', opacity: sending ? 0.7 : 1 }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 sm:p-5" style={{ borderColor: 'var(--baseline)' }}>
          <div
            role={status === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className="text-xs"
            style={{ color: status === 'error' ? 'var(--status-critical)' : 'var(--status-good)' }}
          >
            {status === 'sent' && 'Email sent.'}
            {status === 'error' && errorMessage}
          </div>
          <motion.button
            type="submit"
            whileTap={{ scale: 0.97 }}
            disabled={sending}
            aria-busy={sending}
            className={`rounded-full px-5 py-2 text-sm font-medium text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 ${FOCUS_RING}`}
            style={{ background: 'var(--series-1)' }}
          >
            {sending ? 'Sending…' : 'Send'}
          </motion.button>
        </div>
      </form>
    </div>
  );
}
