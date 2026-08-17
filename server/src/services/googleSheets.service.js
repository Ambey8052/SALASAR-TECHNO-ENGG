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
