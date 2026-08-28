import { useState } from 'react';
import { EmailComposer } from '../components/email/EmailComposer';
import {
  ZETWERK_SUBJECT,
  ZETWERK_TO,
  ZETWERK_CC,
  ZETWERK_BODY,
  CNC_SUBJECT,
  CNC_BODY,
  HSD_MACHINE_SUBJECT,
  HSD_MACHINE_BODY,
} from '../components/email/emailTemplates';

const REPORTS = {
  zetwerk: { label: 'Zetwerk', subject: ZETWERK_SUBJECT, to: ZETWERK_TO, cc: ZETWERK_CC, body: ZETWERK_BODY },
  cnc: { label: 'CNC', subject: CNC_SUBJECT, to: [], cc: [], body: CNC_BODY },
  hsdMachine: { label: 'HSD-(Machine)', subject: HSD_MACHINE_SUBJECT, to: [], cc: [], body: HSD_MACHINE_BODY },
};

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--series-1)]';

export function Email() {
  const [activeTab, setActiveTab] = useState('zetwerk');
  const report = REPORTS[activeTab];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        Email
      </h1>

      <div className="mb-4 flex gap-1 rounded-xl border p-1" style={{ background: 'var(--surface-1)', width: 'fit-content' }} role="tablist" aria-label="Report type">
        {Object.entries(REPORTS).map(([key, { label }]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING}`}
            style={{
              background: activeTab === key ? 'var(--series-1)' : 'transparent',
              color: activeTab === key ? '#ffffff' : 'var(--text-secondary)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* key={activeTab} remounts the composer on tab switch, so each report's draft state
          (recipients, subject, body edits) stays fully independent of the other. */}
      <EmailComposer
        key={activeTab}
        defaultSubject={report.subject}
        defaultTo={report.to}
        defaultCc={report.cc}
        bodyHtml={report.body}
      />
    </div>
  );
}
