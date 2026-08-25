// Shared building blocks for every weekly-report email template (Zetwerk, CNC, and any
// future report type). Keeping these here means EmailComposer stays report-agnostic, and a
// new report type only needs a new body-template + subject/recipient defaults, not a copy of
// the whole compose form.

// Each upload slot is a non-editable "island" inside the rich-text body: clicking it,
// pressing Enter/Space on it, or dragging an image file onto it opens/accepts a file (see
// EmailComposer's handleBodyClick/handleBodyKeyDown/handleBodyDrop), and the chosen image
// replaces the placeholder in place. Being contenteditable="false" keeps it from being typed
// into while the surrounding report text stays fully editable.
export function uploadBoxHtml() {
  return `<div class="upload-box" data-upload-box contenteditable="false" role="button" tabindex="0" aria-label="Upload image"
      style="margin:8px 0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:130px;border:2px dashed var(--baseline);border-radius:10px;cursor:pointer;background:var(--surface-1);color:var(--text-secondary);font-size:13px;font-weight:500;text-align:center;transition:border-color .15s,background .15s;">
    <span style="font-size:20px;">📁</span>
    <span>Drag &amp; drop an image, or click to upload</span>
  </div>`;
}

// A "line" is a piece of fixed report text with a small pencil icon at the end; clicking
// the icon selects that line's text so the process coordinator can type over it immediately,
// without needing a formatting toolbar or hunting for where the editable text starts.
export function reportLineHtml(innerHtml, extraStyle = '') {
  return `<p class="report-line" data-line style="${extraStyle}">
    <span class="line-text">${innerHtml}</span>
    <button type="button" data-edit-line contenteditable="false" aria-label="Edit this line" title="Edit text"
        style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-left:4px;border:none;background:transparent;cursor:pointer;font-size:13px;line-height:1;vertical-align:middle;opacity:.55;">✏️</button>
  </p>`;
}

export function workerRowHtml(number, sample) {
  return `${reportLineHtml(`${number}. ${sample}`, 'margin:10px 0 0;')}${uploadBoxHtml()}`;
}

export const SIGNATURE_HTML = `
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

const CLOSING_HTML = (regardsLine) => `
  <p style="margin-top:16px;">This is for your record and progress.</p>
  <p>Kindly get in touch if any support is needed.</p>
  <p>${regardsLine}</p>
`;

// --- Zetwerk weekly report ---------------------------------------------------------------

export const ZETWERK_SUBJECT = 'Weekly Zetwerk MIS and Department Performance Report- Week 34 from (17-08-26) to (23-08-26).';

export const ZETWERK_TO = ['amit.ojha@salasartechno.com', 'kunal.kumar@salasartechno.com'];

export const ZETWERK_CC = [
  'bharat.agarwal@salasartechno.com',
  'shashank.agarwal@salasartechno.com',
  'shalabh.agarwal@salasartechno.com',
  'dhruv.agarwal@salasartechno.com',
  'bhanu.pratap1@salasartechno.com',
  'ea.hsd@salasartechno.com',
  'amit.pathak@salasartechno.com',
  'pc.gi@salasartechno.com',
];

const ZETWERK_WORKERS = [
  'Ajay Panwar (Project- Indus GBM Swage Pole- Punching,Swaging,Drilling,Welding)',
  'Jagdeesh Kumar (Project- Solar,Indus GBM- Tacking,Welding)',
  'Ram Milan (Project- Indus GBM - Welding, Rolling, Tacking)',
  'Sunil Tomar (Project- Solar- Rolling,Punching)',
  'Vishal (Project- Swage Pole,Solar,Indus GBM- Punching,Rolling,Drilling,Welding,Tacking)',
  'Bharat Rai (Project-Swage Pole,Solar- Punching,Rolling,Drilling,Welding,Tacking,Binding)',
];

export const ZETWERK_BODY = `
  <p>Dear Production Head,</p>
  <p>Please find attached the Weekly performance for your department, please check and review,</p>
  ${reportLineHtml('<strong>1. MIS Production Department Report,</strong>', 'margin-top:12px;')}
  ${uploadBoxHtml()}
  ${reportLineHtml('<strong>2. Full department performance,</strong>')}
  ${uploadBoxHtml()}
  ${reportLineHtml('<strong>3. Supervisor performance</strong>')}
  <div id="worker-list">
    ${ZETWERK_WORKERS.map((w, i) => workerRowHtml(i + 1, w)).join('\n')}
  </div>
  ${CLOSING_HTML('Thanks and Regards,')}
  ${SIGNATURE_HTML}
`;

// --- CNC weekly report -------------------------------------------------------------------

export const CNC_SUBJECT = 'Weekly CNC MIS and Department Performance report - Week 34 from (17-08-26) to (23-08-26)';

const CNC_SUPERVISORS = [
  'Dushyant (Project- Ramboll,Associated Power)',
  'Mohit (Project- Ramboll,Octapole,Adani)',
  'Puspender (Project- COW Tower)',
  'Manish (Project- Ramboll,Adani)',
  'Rahul (Project- Ramboll)',
  'Vishal Rana (Project- Ramboll)',
  'Pradeep (Project- Ramboll,Cow Tower)',
  'Robin (Project- Adani, Ramboll,Cow Tower)',
  'Mayank (Project- Ramboll,Associated Power)',
  'Deepak (Project- COW Tower,Ramboll)',
];

export const CNC_BODY = `
  <p>Dear Production Head,</p>
  <p>Please find attached the Weekly performance for your department, please check and review,</p>
  ${reportLineHtml('<strong>1. MIS Production Department Report</strong>', 'margin-top:12px;')}
  ${uploadBoxHtml()}
  ${reportLineHtml('<strong>2. Full department performance,</strong>')}
  ${uploadBoxHtml()}
  ${reportLineHtml('<strong>3. MIS CNC Machine Report</strong>')}
  ${uploadBoxHtml()}
  ${reportLineHtml('<strong>4. CNC Machine department performance,</strong>')}
  ${uploadBoxHtml()}
  ${reportLineHtml('<strong>5. Supervisor wise performance,</strong>')}
  <div id="worker-list">
    ${CNC_SUPERVISORS.map((w, i) => workerRowHtml(i + 1, w)).join('\n')}
  </div>
  ${CLOSING_HTML('Regards,')}
  ${SIGNATURE_HTML}
`;
