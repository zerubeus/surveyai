/**
 * SurveyAI E2E Test — Sprint 11
 * Covers: login → dashboard → new project → steps 1–7
 * Logs: backend errors, UI issues, loading screen problems
 */

// Use playwright from npx cache
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
import { writeFileSync, appendFileSync } from 'fs';

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'dev@surveyai.test';
const TEST_PASSWORD = 'devpassword123';
const CSV_PATH = '/root/.openclaw/media/inbound/170e1475-ec92-4080-8d25-ea5bcdf3b7a4.csv';
const DOCX_PATH = '/root/.openclaw/media/inbound/01d24ef2-96da-4d59-baa0-71b15f49d68f.docx';

const LOG_FILE = '/root/projects/surveyai/test-results.md';
const issues = [];
let stepCount = 0;

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function issue(severity, location, description, extra = '') {
  const entry = { severity, location, description, extra };
  issues.push(entry);
  log(`⚠️  [${severity}] ${location}: ${description}`);
}

function pass(location, msg) {
  log(`✅ ${location}: ${msg}`);
}

async function waitAndCheck(page, selector, label, timeout = 8000) {
  try {
    await page.waitForSelector(selector, { timeout });
    pass(label, `found "${selector}"`);
    return true;
  } catch {
    issue('HIGH', label, `Element not found: "${selector}"`);
    return false;
  }
}

async function checkConsoleErrors(page, label) {
  // Already attached via listener — just note
}

async function screenshot(page, name) {
  try {
    await page.screenshot({ path: `/root/projects/surveyai/screenshots/${name}.png`, fullPage: true });
  } catch {}
}

async function run() {
  // Setup
  try {
    const { mkdirSync } = await import('fs');
    mkdirSync('/root/projects/surveyai/screenshots', { recursive: true });
  } catch {}

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ url: page.url(), text: msg.text() });
    }
  });
  page.on('pageerror', err => {
    issue('HIGH', page.url(), `JS Page Error: ${err.message}`);
  });
  page.on('requestfailed', req => {
    issue('MEDIUM', 'Network', `Failed request: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });

  // ─── AUTH ────────────────────────────────────────────────────────────
  log('=== AUTH ===');
  await page.goto(`${BASE_URL}/auth/login`);
  await screenshot(page, '01-login-page');

  // Check login page elements
  await waitAndCheck(page, 'input[type="email"], input[name="email"]', 'Login - email field');
  await waitAndCheck(page, 'input[type="password"], input[name="password"]', 'Login - password field');
  await waitAndCheck(page, 'button[type="submit"], button:has-text("Sign in"), button:has-text("Login")', 'Login - submit button');

  // Check for broken layout or overlapping elements
  const loginTitle = await page.$('h1, h2');
  if (!loginTitle) issue('LOW', 'Login page', 'No visible heading/title found');

  // Try login
  try {
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passInput = await page.$('input[type="password"], input[name="password"]');
    if (emailInput && passInput) {
      await emailInput.fill(TEST_EMAIL);
      await passInput.fill(TEST_PASSWORD);
      await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    issue('HIGH', 'Login', `Login interaction failed: ${e.message}`);
  }

  await screenshot(page, '02-after-login');
  const currentUrl = page.url();
  log(`After login URL: ${currentUrl}`);

  if (currentUrl.includes('/auth/login') || currentUrl.includes('/auth/error')) {
    issue('HIGH', 'Auth', `Login may have failed — still on: ${currentUrl}. Test user may not exist in DB.`);
    // Try signup instead
    await page.goto(`${BASE_URL}/auth/signup`);
    await screenshot(page, '02b-signup-page');
    await waitAndCheck(page, 'input[type="email"]', 'Signup - email field');
    await waitAndCheck(page, 'input[type="password"]', 'Signup - password field');
  }

  // ─── DASHBOARD ────────────────────────────────────────────────────────
  log('=== DASHBOARD ===');
  if (!currentUrl.includes('/auth/')) {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForTimeout(2000);
    await screenshot(page, '03-dashboard');
    await waitAndCheck(page, 'main, [data-testid="dashboard"]', 'Dashboard - main content');

    // Check for old/misplaced components
    const dashboardHtml = await page.content();
    if (dashboardHtml.includes('undefined') && dashboardHtml.includes('undefined')) {
      issue('MEDIUM', 'Dashboard', 'Possible undefined values rendered in DOM');
    }

    // Check loading state doesn't get stuck
    const loadingVisible = await page.$('[data-loading="true"], .loading, [aria-busy="true"]');
    if (loadingVisible) {
      await page.waitForTimeout(5000);
      const stillLoading = await page.$('[data-loading="true"], .loading, [aria-busy="true"]');
      if (stillLoading) {
        issue('HIGH', 'Dashboard', 'Loading state appears stuck after 5+ seconds');
      }
    }

    // Check new project button
    const newProjectBtn = await page.$('a[href="/projects/new"], button:has-text("New"), button:has-text("Create"), a:has-text("New Project")');
    if (!newProjectBtn) {
      issue('MEDIUM', 'Dashboard', 'No "New Project" button found');
    } else {
      pass('Dashboard', '"New Project" button present');
    }
  }

  // ─── NEW PROJECT FLOW ─────────────────────────────────────────────────
  log('=== NEW PROJECT / STEP 1 ===');
  await page.goto(`${BASE_URL}/projects/new`);
  await page.waitForTimeout(2000);
  await screenshot(page, '04-new-project-step1');

  // Check step indicator / stepper
  const stepper = await page.$('[data-testid="step-bar"], nav[aria-label*="step"], .stepper, ol');
  if (!stepper) issue('LOW', 'Step 1', 'No step indicator/stepper visible');
  else pass('Step 1', 'Stepper present');

  // Check form fields
  await waitAndCheck(page, 'input[name="name"], input[placeholder*="project"], input[placeholder*="Project"]', 'Step 1 - project name input');
  await waitAndCheck(page, 'textarea, input[name*="question"], input[placeholder*="research"]', 'Step 1 - research question input');

  // Check loading state on page entry
  const step1Loading = await page.$('.skeleton, [data-loading], [aria-busy="true"]');
  if (step1Loading) {
    await page.waitForTimeout(3000);
    const stillLoading = await page.$('.skeleton, [data-loading], [aria-busy="true"]');
    if (stillLoading) issue('HIGH', 'Step 1', 'Skeleton/loading state stuck on page load');
  }

  // Check all pages quickly for basic render
  const stepPages = [
    `${BASE_URL}/projects/new`,
  ];

  // Try to navigate to non-existent project steps to catch 404s vs proper handling
  log('=== STEP ROUTES (unauthenticated/empty project check) ===');
  for (const stepNum of [1, 2, 3, 4, 5, 6, 7]) {
    try {
      await page.goto(`${BASE_URL}/projects/test-id-123/step/${stepNum}`);
      await page.waitForTimeout(1500);
      const url = page.url();
      const status = await page.evaluate(() => document.title);
      const has404 = await page.$('text=404, text=not found, [data-testid="404"]');
      const hasError = await page.$('text=Something went wrong, text=Error');
      
      if (has404) {
        log(`  Step ${stepNum}: 404 page shown (OK for invalid project ID)`);
      } else if (hasError) {
        issue('MEDIUM', `Step ${stepNum}`, 'Error state shown for invalid project — check error boundary UI');
      } else {
        pass(`Step ${stepNum}`, `Route accessible (${url})`);
      }
      await screenshot(page, `05-step${stepNum}-empty`);
    } catch (e) {
      issue('HIGH', `Step ${stepNum}`, `Navigation failed: ${e.message}`);
    }
  }

  // ─── AUTH ERROR PAGE ────────────────────────────────────────────────
  log('=== AUTH ERROR PAGE ===');
  await page.goto(`${BASE_URL}/auth/error`);
  await page.waitForTimeout(1000);
  await screenshot(page, '06-auth-error');
  const authErrorContent = await page.content();
  if (authErrorContent.includes('undefined') || authErrorContent.includes('null')) {
    issue('LOW', 'Auth Error page', 'May be rendering undefined/null values');
  }

  // ─── RESPONSIVE CHECK ────────────────────────────────────────────────
  log('=== RESPONSIVE / MOBILE ===');
  await context.setDefaultViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE_URL}/auth/login`);
  await page.waitForTimeout(1000);
  await screenshot(page, '07-login-mobile');
  
  const mobileOverflow = await page.evaluate(() => {
    return document.body.scrollWidth > window.innerWidth;
  });
  if (mobileOverflow) {
    issue('MEDIUM', 'Login - Mobile', 'Horizontal overflow detected on mobile viewport (375px)');
  }

  await page.goto(`${BASE_URL}/projects/new`);
  await page.waitForTimeout(1000);
  const newProjectMobileOverflow = await page.evaluate(() => {
    return document.body.scrollWidth > window.innerWidth;
  });
  if (newProjectMobileOverflow) {
    issue('MEDIUM', 'New Project - Mobile', 'Horizontal overflow detected on mobile viewport');
  }
  await screenshot(page, '08-new-project-mobile');

  // ─── CHECK CONSOLE ERRORS ────────────────────────────────────────────
  if (consoleErrors.length > 0) {
    log(`\n=== CONSOLE ERRORS (${consoleErrors.length}) ===`);
    consoleErrors.slice(0, 20).forEach(e => {
      issue('MEDIUM', `Console [${e.url}]`, e.text.slice(0, 200));
    });
  }

  await browser.close();

  // ─── REPORT ──────────────────────────────────────────────────────────
  const HIGH = issues.filter(i => i.severity === 'HIGH');
  const MEDIUM = issues.filter(i => i.severity === 'MEDIUM');
  const LOW = issues.filter(i => i.severity === 'LOW');

  const report = `# SurveyAI E2E Test Report
Generated: ${new Date().toISOString()}

## Summary
- 🔴 HIGH: ${HIGH.length}
- 🟡 MEDIUM: ${MEDIUM.length}  
- 🔵 LOW: ${LOW.length}
- Total issues: ${issues.length}

## HIGH Priority Issues
${HIGH.map(i => `- **${i.location}**: ${i.description}${i.extra ? '\n  ' + i.extra : ''}`).join('\n') || '- None'}

## MEDIUM Priority Issues
${MEDIUM.map(i => `- **${i.location}**: ${i.description}${i.extra ? '\n  ' + i.extra : ''}`).join('\n') || '- None'}

## LOW Priority Issues
${LOW.map(i => `- **${i.location}**: ${i.description}`).join('\n') || '- None'}

## Screenshots
Saved to: /root/projects/surveyai/screenshots/
`;

  writeFileSync(LOG_FILE, report);
  log(`\nReport saved to ${LOG_FILE}`);
  log(`\nSUMMARY: ${HIGH.length} HIGH | ${MEDIUM.length} MEDIUM | ${LOW.length} LOW`);

  return { HIGH, MEDIUM, LOW, all: issues };
}

run().catch(e => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
