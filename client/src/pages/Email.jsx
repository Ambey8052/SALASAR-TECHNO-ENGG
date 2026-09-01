import { useState } from 'react';
import { EmailComposer } from '../components/email/EmailComposer';
import {
  ZETWERK_SUBJECT,
  ZETWERK_TO,
  ZETWERK_CC,
  ZETWERK_BODY,
  CNC_SUBJECT,
  CNC_BODY,
  HSD_PRODUCTION_SUBJECT,
  HSD_PRODUCTION_BODY,
  HSD_MACHINE_SUBJECT,
  HSD_MACHINE_BODY,
  HSD_PAINTING_SUBJECT,
  HSD_PAINTING_BODY,
  HSD_QUALITY_SUBJECT,
  HSD_QUALITY_BODY,
  COW_SUBJECT,
  COW_BODY,
  RAMBOLL_SUBJECT,
  RAMBOLL_BODY,
} from '../components/email/emailTemplates';

const REPORTS = {
  zetwerk: { label: 'Zetwerk', subject: ZETWERK_SUBJECT, to: ZETWERK_TO, cc: ZETWERK_CC, body: ZETWERK_BODY },
  cnc: { label: 'CNC', subject: CNC_SUBJECT, to: [], cc: [], body: CNC_BODY },
  hsdProduction: { label: 'HSD-(Production)', subject: HSD_PRODUCTION_SUBJECT, to: [], cc: [], body: HSD_PRODUCTION_BODY },
  hsdMachine: { label: 'HSD-(Machine)', subject: HSD_MACHINE_SUBJECT, to: [], cc: [], body: HSD_MACHINE_BODY },
  hsdPainting: { label: 'HSD-(Painting)', subject: HSD_PAINTING_SUBJECT, to: [], cc: [], body: HSD_PAINTING_BODY },
  hsdQuality: { label: 'HSD-(Quality)', subject: HSD_QUALITY_SUBJECT, to: [], cc: [], body: HSD_QUALITY_BODY },
  cow: { label: 'COW', subject: COW_SUBJECT, to: [], cc: [], body: COW_BODY },
  ramboll: { label: 'Ramboll', subject: RAMBOLL_SUBJECT, to: [], cc: [], body: RAMBOLL_BODY },
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

      <div className="mb-4 flex max-w-full flex-wrap gap-1 rounded-xl border p-1" style={{ background: 'var(--surface-1)', width: 'fit-content' }} role="tablist" aria-label="Report type">
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
