import { OAuth2Client } from 'google-auth-library';
import { env } from './env.js';

export function createLoginOAuthClient() {
  return new OAuth2Client(env.googleClientId, env.googleClientSecret, env.googleLoginRedirectUri);
}

export function createDriveOAuthClient() {
  return new OAuth2Client(env.googleClientId, env.googleClientSecret, env.googleDriveRedirectUri);
}

export function createGmailOAuthClient() {
  return new OAuth2Client(env.googleClientId, env.googleClientSecret, env.gmailSendRedirectUri);
}

export const LOGIN_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export const DRIVE_SYNC_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.readonly',
];

export const GMAIL_SEND_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.send',
];
