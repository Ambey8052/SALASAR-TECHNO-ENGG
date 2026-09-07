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

async function getAuthorizedClient() {
  const tokenDoc = await GoogleToken.findOne({ purpose: 'drive-sync' });
  if (!tokenDoc) throw new DriveNotConnectedError();

  const client = createDriveOAuthClient();
  client.setCredentials({ refresh_token: decryptText(tokenDoc.encryptedRefreshToken) });
  return client;
}

// The source file is a plain .xlsx uploaded to Drive (not a native Google Sheet), so it has
// to be downloaded as raw bytes and parsed locally instead of read via the Sheets API.
let workbookCache = null;
let workbookCachedAt = 0;
const WORKBOOK_CACHE_MS = 5_000;

async function loadWorkbook() {
  if (workbookCache && Date.now() - workbookCachedAt < WORKBOOK_CACHE_MS) {
    return workbookCache;
  }

  const auth = await getAuthorizedClient();
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.get(
    { fileId: env.hsdSpreadsheetId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );

  workbookCache = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
  workbookCachedAt = Date.now();
  return workbookCache;
}

export async function getSheetValues(sheetTitle) {
  const workbook = await loadWorkbook();
  const matchName = workbook.SheetNames.find((name) => name.trim() === sheetTitle.trim());
  const sheet = matchName ? workbook.Sheets[matchName] : undefined;
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false });
}

export async function listSheetTitles() {
  const workbook = await loadWorkbook();
  return workbook.SheetNames.map((title) => ({ title }));
}

// The monthly Synopsis Dispatch reports are a folder of one-workbook-per-month files rather
// than tabs inside the single live workbook above, so they are listed and downloaded
// individually. Unlike loadWorkbook there is no cache here: a sync reads each file exactly
// once, and holding five workbooks in memory between runs buys nothing.
export async function listFolderWorkbooks(folderId) {
  const auth = await getAuthorizedClient();
  const drive = google.drive({ version: 'v3', auth });

  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      pageSize: 200,
      pageToken,
      // Without these the listing silently returns nothing for a folder that lives in a
      // shared drive rather than the connected account's own My Drive.
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  // Google Sheets created natively in Drive report a different mime type and cannot be
  // downloaded with alt=media, so they are excluded here rather than failing mid-download.
  return files.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
}

export async function getWorkbookRows(fileId, mimeType) {
  const auth = await getAuthorizedClient();
  const drive = google.drive({ version: 'v3', auth });

  // A native Google Sheet has to be exported to xlsx; an uploaded .xlsx is downloaded as-is.
  const isNativeSheet = mimeType === 'application/vnd.google-apps.spreadsheet';
  const res = isNativeSheet
    ? await drive.files.export(
        { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { responseType: 'arraybuffer' },
      )
    : await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });

  const workbook = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  // blankrows must stay true: the parser locates the end of a table by counting consecutive
  // blank rows, which collapsing them would destroy.
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: true });
}
