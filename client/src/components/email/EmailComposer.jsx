import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { sendReportEmail, scheduleReportEmail, fetchScheduledEmails, cancelScheduledEmail } from '../../lib/api';
import { PC_HSD_EMAIL } from '../../lib/constants';
import { uploadBoxHtml, reportLineHtml } from './emailTemplates';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INLINE_IMAGE_STYLE = 'max-width:100%;max-height:260px;display:block;margin:8px auto;border-radius:8px;';

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

function toLocalDatetimeValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduleValue() {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  return toLocalDatetimeValue(d);
}

export function EmailComposer({ defaultSubject, defaultTo, defaultCc, bodyHtml }) {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [subject, setSubject] = useState(defaultSubject);
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [errorMessage, setErrorMessage] = useState('');
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleValue);
  const [scheduleMessage, setScheduleMessage] = useState('');
  const bodyRef = useRef(null);
  const boxFileInputRef = useRef(null);
  const pendingBoxRef = useRef(null);
  const sending = status === 'sending';
  const queryClient = useQueryClient();

  const scheduledQuery = useQuery({
    queryKey: ['scheduled-emails'],
    queryFn: fetchScheduledEmails,
  });

  const scheduleMutation = useMutation({
    mutationFn: scheduleReportEmail,
    onSuccess: (data) => {
      setShowScheduler(false);
      setScheduleMessage(`Scheduled for ${format(new Date(data.sendAt), "d MMM yyyy, h:mm a")}.`);
      queryClient.invalidateQueries({ queryKey: ['scheduled-emails'] });
    },
    onError: (err) => {
      setScheduleMessage(err?.response?.data?.error || 'Failed to schedule email. Please try again.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelScheduledEmail,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scheduled-emails'] }),
  });

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

  // New sections/images always land just above the signature (never after it), matching
  // where every static template already puts its content relative to the sign-off.
  function insertBeforeSignature(html) {
    const body = bodyRef.current;
    if (!body) return [];
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const nodes = [...temp.childNodes];
    const signature = body.querySelector('#email-signature');
    nodes.forEach((node) => body.insertBefore(node, signature || null));
    return nodes;
  }

  function handleAddSection() {
    if (sending) return;
    const nodes = insertBeforeSignature(`${reportLineHtml('New section', 'margin-top:12px;')}${uploadBoxHtml()}`);
    const editBtn = nodes.find((n) => n.nodeType === 1 && n.matches('[data-line]'))?.querySelector('[data-edit-line]');
    if (editBtn) selectLineText(editBtn);
  }

  function handleAddImage() {
    if (sending) return;
    insertBeforeSignature(uploadBoxHtml());
  }

  function insertImageAtCaret(dataUrl) {
    const body = bodyRef.current;
    if (!body) return;
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Pasted image';
    img.style.cssText = INLINE_IMAGE_STYLE;

    const selection = window.getSelection();
    if (selection?.rangeCount && body.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      body.insertBefore(img, body.querySelector('#email-signature') || null);
    }
  }

  function handleBodyPaste(e) {
    if (sending) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItem = [...items].find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!imageItem) return; // not an image — let normal text paste proceed
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => insertImageAtCaret(reader.result);
    reader.readAsDataURL(file);
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

  // The pencil edit-icons are a compose-time affordance only — strip them (on a detached
  // clone, so the live compose view is untouched) before this HTML goes out to recipients.
  function getOutgoingBodyHtml() {
    if (!bodyRef.current) return '';
    const clone = bodyRef.current.cloneNode(true);
    clone.querySelectorAll('[data-edit-line]').forEach((el) => el.remove());
    return clone.innerHTML;
  }

  function validateBeforeSend() {
    if (to.length === 0) return 'Add at least one "To" recipient.';
    if (!subject.trim()) return 'Subject is required.';
    return null;
  }

  async function handleSend(e) {
    e.preventDefault();
    const validationError = validateBeforeSend();
    if (validationError) {
      setStatus('error');
      setErrorMessage(validationError);
      return;
    }

    setStatus('sending');
    setErrorMessage('');
    setScheduleMessage('');
    try {
      await sendReportEmail({ to, cc, subject, bodyHtml: getOutgoingBodyHtml() });
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err?.response?.data?.error || 'Failed to send email. Please try again.');
    }
  }

  function handleScheduleClick() {
    const validationError = validateBeforeSend();
    if (validationError) {
      setStatus('error');
      setErrorMessage(validationError);
      return;
    }
    setStatus('idle');
    setErrorMessage('');
    setScheduleMessage('');
    setShowScheduler((v) => !v);
  }

  function handleScheduleConfirm() {
    const sendAt = new Date(scheduleAt);
    if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() < Date.now() + 60_000) {
      setScheduleMessage('Pick a time at least a minute from now.');
      return;
    }
    scheduleMutation.mutate({ to, cc, subject, bodyHtml: getOutgoingBodyHtml(), sendAt: sendAt.toISOString() });
  }

  return (
    <div>
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

          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddSection}
              disabled={sending}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
              style={{ color: 'var(--text-secondary)' }}
            >
              + Add section
            </button>
            <button
              type="button"
              onClick={handleAddImage}
              disabled={sending}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
              style={{ color: 'var(--text-secondary)' }}
            >
              + Add image
            </button>
          </div>

          <div
            id="email-body"
            ref={bodyRef}
            contentEditable={!sending}
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
            role="textbox"
            aria-multiline="true"
            aria-label="Email body"
            data-placeholder="Write your report…"
            onClick={handleBodyClick}
            onKeyDown={handleBodyKeyDown}
            onDragOver={handleBodyDragOver}
            onDragLeave={handleBodyDragLeave}
            onDrop={handleBodyDrop}
            onPaste={handleBodyPaste}
            className={`min-h-[280px] w-full rounded-lg border p-4 text-sm leading-relaxed disabled:cursor-not-allowed empty:before:italic empty:before:text-[var(--text-muted)] empty:before:content-[attr(data-placeholder)] [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_img]:my-2 [&_img]:max-w-full [&_li]:ml-4 [&_p]:mb-2 [&_ul]:list-disc ${FOCUS_RING}`}
            style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', borderColor: 'var(--baseline)', opacity: sending ? 0.7 : 1 }}
          />
        </div>

        <div className="flex flex-col gap-3 border-t p-4 sm:p-5" style={{ borderColor: 'var(--baseline)' }}>
          {showScheduler && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3" style={{ background: 'var(--surface-2)', borderColor: 'var(--baseline)' }}>
              <label htmlFor="schedule-at" className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                Send at
              </label>
              <input
                id="schedule-at"
                type="datetime-local"
                value={scheduleAt}
                min={toLocalDatetimeValue(new Date(Date.now() + 60_000))}
                onChange={(e) => setScheduleAt(e.target.value)}
                className={`rounded-lg border-0 px-3 py-1.5 text-sm ${FOCUS_RING}`}
                style={{ background: 'var(--surface-1)', color: 'var(--text-primary)' }}
              />
              <button
                type="button"
                onClick={handleScheduleConfirm}
                disabled={scheduleMutation.isPending}
                className={`rounded-full px-4 py-1.5 text-sm font-medium text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                style={{ background: 'var(--series-1)' }}
              >
                {scheduleMutation.isPending ? 'Scheduling…' : 'Confirm schedule'}
              </button>
              <button
                type="button"
                onClick={() => setShowScheduler(false)}
                className={`text-xs underline ${FOCUS_RING}`}
                style={{ color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role={status === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              className="text-xs"
              style={{ color: status === 'error' ? 'var(--status-critical)' : 'var(--status-good)' }}
            >
              {status === 'sent' && 'Email sent.'}
              {status === 'error' && errorMessage}
              {scheduleMessage}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleScheduleClick}
                disabled={sending}
                aria-expanded={showScheduler}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                style={{ color: 'var(--text-primary)' }}
              >
                Schedule
              </button>
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
          </div>
        </div>
      </form>

      {scheduledQuery.data?.length > 0 && (
        <div className="mt-4 rounded-2xl border p-4 sm:p-5" style={{ background: 'var(--surface-1)' }}>
          <div className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Scheduled emails
          </div>
          <ul className="space-y-2">
            {scheduledQuery.data.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--baseline)' }}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                    {s.subject}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {format(new Date(s.sendAt), "d MMM yyyy, h:mm a")} · to {s.to.join(', ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => cancelMutation.mutate(s.id)}
                  disabled={cancelMutation.isPending}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                  style={{ color: 'var(--status-critical)' }}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
