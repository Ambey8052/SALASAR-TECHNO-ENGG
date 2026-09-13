import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { createDriveOAuthClient } from '../config/google.js';
import { GoogleToken } from '../models/GoogleToken.js';
import { decryptText } from '../utils/crypto.js';
import { env } from '../config/env.js';

export class DriveNotConnectedError extends Error {
  constructor() {
    super('Google Drive sync has not been connected yet. An admin must visit /api/auth/google/connect-drive.');
    this.name = 'DriveNotConnectedError';
  }
}

// googleapis sets no timeout of its own, so one stalled download used to hold a sync open
// indefinitely while further cron ticks piled up behind it.
const DRIVE_TIMEOUT_MS = 60_000;

function isTransient(err) {
  const status = err?.response?.status ?? err?.code;
  return status === 429 || (typeof status === 'number' && status >= 500) ||
    ['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EAI_AGAIN'].includes(err?.code);
}

// One retry after a short pause for rate limits, 5xx and dropped connections. Anything else —
// a revoked grant, a missing file — fails straight away with Drive's own message.
async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isTransient(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    return fn();
  }
}

async function getDrive() {
  const tokenDoc = await GoogleToken.findOne({ purpose: 'drive-sync' });
  if (!tokenDoc) throw new DriveNotConnectedError();

  const client = createDriveOAuthClient();
  client.setCredentials({ refresh_token: decryptText(tokenDoc.encryptedRefreshToken) });
  return google.drive({ version: 'v3', auth: client });
}

// The source file is a plain .xlsx uploaded to Drive (not a native Google Sheet), so it has
// to be downloaded as raw bytes and parsed locally instead of read via the Sheets API.
//
// It is downloaded once per sync and every tab is read from that one copy. It used to be cached
// for five seconds instead, so a sync whose Manpower step ran longer than that read the progress
// and dispatch tabs from a second download — two versions of a sheet that is edited all day,
// mixed in one run.
export async function openLiveWorkbook() {
  const drive = await getDrive();
  const [meta, res] = await Promise.all([
    withRetry(() => drive.files.get(
      { fileId: env.hsdSpreadsheetId, fields: 'id, name, modifiedTime', supportsAllDrives: true },
      { timeout: DRIVE_TIMEOUT_MS },
    )),
    withRetry(() => drive.files.get(
      { fileId: env.hsdSpreadsheetId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer', timeout: DRIVE_TIMEOUT_MS },
    )),
  ]);

  const workbook = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
  return {
    fileId: meta.data.id,
    name: meta.data.name,
    modifiedTime: meta.data.modifiedTime ? new Date(meta.data.modifiedTime) : null,
    // A tab that has been renamed or removed reads as empty; the parsers then report that no
    // header rows were found rather than failing the whole run.
    getSheetValues(sheetTitle) {
      const matchName = workbook.SheetNames.find((name) => name.trim() === sheetTitle.trim());
      const sheet = matchName ? workbook.Sheets[matchName] : undefined;
      if (!sheet) return [];
      return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false });
    },
  };
}

// The monthly Dispatch Synopsis reports are a folder of one-workbook-per-month files rather
// than tabs inside the single live workbook above, so they are listed and downloaded
// individually.
export async function listFolderWorkbooks(folderId) {
  const drive = await getDrive();

  const files = [];
  let pageToken;
  do {
    const res = await withRetry(() => drive.files.list(
      {
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
        pageSize: 200,
        pageToken,
        // Without these the listing silently returns nothing for a folder that lives in a
        // shared drive rather than the connected account's own My Drive.
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
      { timeout: DRIVE_TIMEOUT_MS },
    ));
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  // Sub-folders are not workbooks.
  return files.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
}

export async function getWorkbookRows(fileId, mimeType) {
  const drive = await getDrive();

  // A native Google Sheet has to be exported to xlsx; an uploaded .xlsx is downloaded as-is.
  const isNativeSheet = mimeType === 'application/vnd.google-apps.spreadsheet';
  const res = await withRetry(() => (isNativeSheet
    ? drive.files.export(
        { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { responseType: 'arraybuffer', timeout: DRIVE_TIMEOUT_MS },
      )
    : drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer', timeout: DRIVE_TIMEOUT_MS })));

  const workbook = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  // blankrows must stay true: the parser locates the end of a table by counting consecutive
  // blank rows, which collapsing them would destroy.
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: true });
}
