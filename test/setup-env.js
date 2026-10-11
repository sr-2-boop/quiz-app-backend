// Test configuration. Runs before any test module imports src/config/env.js.
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/quiz-test-unused',
  CLIENT_ORIGIN: 'http://localhost:5173',
  JWT_SECRET: 'test-secret-that-is-definitely-longer-than-32-chars',
  JWT_EXPIRES_IN: '6h',
  COOKIE_SECURE: 'false',
  TRUST_PROXY: '0',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  ADMIN_EMAILS: 'admin@uni.edu,second.admin@uni.edu',
  CODE_EXECUTION_ENABLED: 'false',
});
