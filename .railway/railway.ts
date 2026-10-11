import { defineRailway, github, project, service } from 'railway/iac';

export default defineRailway(() => {
  const backend = service('backend', {
    source: github('sr-2-boop/quiz-app-backend'),
    build: 'npm ci',
    start: 'npm start',
    healthcheck: '/api/health',
    env: {
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      COOKIE_SAME_SITE: 'none',
      TRUST_PROXY: '1',
      CODE_EXECUTION_ENABLED: 'false',
    },
  });

  return project('quiz-app-backend', { resources: [backend] });
});
