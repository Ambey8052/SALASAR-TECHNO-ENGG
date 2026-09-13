// Imported first by every test file, before anything reads config/env.js. It pins a known
// configuration so results do not depend on whoever's server/.env happens to be on disk — and,
// above all, so no test can ever reach a real database: MONGODB_URI is forced to an address
// nothing listens on. Integration tests connect to their own in-memory MongoDB explicitly.
// (dotenv never overrides a variable that is already set.)
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/never-used-by-tests';
process.env.NODE_ENV = 'test';
delete process.env.RENDER;
delete process.env.RENDER_EXTERNAL_URL;
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.TOKEN_ENCRYPTION_KEY = 'test-token-encryption-key';
process.env.ADMIN_EMAILS = 'admin@salasartechno.com,owner@gmail.com';
process.env.EMAIL_USER = 'pc.hsd@salasartechno.com';
process.env.ALLOWED_LOGIN_DOMAINS = 'salasartechno.com';
process.env.ALLOWED_LOGIN_EMAILS = 'guest@gmail.com';
process.env.CLIENT_ORIGIN = 'http://localhost:5173/';
process.env.SYNOPSIS_FOLDER_ID = 'test-synopsis-folder';
process.env.GEMINI_API_KEY = '';
