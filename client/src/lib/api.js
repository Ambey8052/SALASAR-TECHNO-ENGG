import axios from 'axios';

// In local dev this stays empty and Vite's proxy (vite.config.js) forwards /api to
// localhost:5001. In production the client (Vercel) and server (Render) are different
// origins, so VITE_API_URL must point at the deployed server, e.g.
// https://salasar-techno-engg.onrender.com.
export const API_BASE = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
  baseURL: `${API_BASE}/api`,
  withCredentials: true,
});

export async function fetchMe() {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function logout() {
  await api.post('/auth/logout');
}

export async function fetchHsdSummary(params) {
  const { data } = await api.get('/dashboard/hsd/summary', { params });
  return data;
}

export async function fetchHsdInsights(params) {
  const { data } = await api.get('/dashboard/hsd/insights', { params, timeout: 75_000 });
  return data;
}

export async function fetchManpowerRecords(params) {
  const { data } = await api.get('/dashboard/manpower', { params });
  return data;
}

export async function fetchSyncStatus() {
  const { data } = await api.get('/sync/status');
  return data;
}

export async function triggerSync() {
  const { data } = await api.post('/sync/run');
  return data;
}

export async function disconnectDrive() {
  const { data } = await api.post('/auth/google/disconnect-drive');
  return data;
}

export async function fetchTargets() {
  const { data } = await api.get('/targets');
  return data;
}

export async function saveTarget(client, qty) {
  const { data } = await api.post('/targets', { client, qty });
  return data;
}

export async function deleteTarget(client) {
  const { data } = await api.delete(`/targets/${encodeURIComponent(client)}`);
  return data;
}

export async function sendReportEmail({ to, cc, subject, bodyHtml }) {
  const { data } = await api.post('/email/send', { to, cc, subject, bodyHtml }, { timeout: 60_000 });
  return data;
}

export async function scheduleReportEmail({ to, cc, subject, bodyHtml, sendAt }) {
  const { data } = await api.post('/email/schedule', { to, cc, subject, bodyHtml, sendAt }, { timeout: 60_000 });
  return data;
}

export async function fetchScheduledEmails() {
  const { data } = await api.get('/email/scheduled');
  return data;
}

export async function cancelScheduledEmail(id) {
  const { data } = await api.delete(`/email/scheduled/${id}`);
  return data;
}

export async function fetchGmailSendStatus() {
  const { data } = await api.get('/auth/google/gmail-send-status');
  return data;
}
