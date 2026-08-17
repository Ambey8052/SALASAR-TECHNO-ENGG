import dotenv from 'dotenv';

dotenv.config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5001),

  mongoUri: required('MONGODB_URI'),

  googleClientId: required('GOOGLE_CLIENT_ID'),
  googleClientSecret: required('GOOGLE_CLIENT_SECRET'),
  googleLoginRedirectUri: required('GOOGLE_LOGIN_REDIRECT_URI', 'http://localhost:5001/api/auth/google/callback'),
  googleDriveRedirectUri: required('GOOGLE_DRIVE_REDIRECT_URI', 'http://localhost:5001/api/auth/google/connect-drive/callback'),

  jwtSecret: required('JWT_SECRET', 'dev-only-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  tokenEncryptionKey: required('TOKEN_ENCRYPTION_KEY', 'dev-only-32-char-change-me-please!!'),

  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),

  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  hsdSpreadsheetId: required('HSD_SPREADSHEET_ID', '1-O9T8zA4yAFYzq9LW2fgn5hIdy7MsAPq'),
  syncIntervalMinutes: Number(process.env.SYNC_INTERVAL_MINUTES || 10),
};
