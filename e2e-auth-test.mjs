/**
 * SurveyAI Full E2E Test — Authenticated
 * Tests all 7 steps + dashboard + auth flow
 */

import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'dev@surveyai.test';
const PASSWORD = 'devpassword123';
const CSV_PATH = '/root/.openclaw/media/inbound/170e1475-ec92-4080-8d25-ea5bcdf3b7a4.csv';
const DOCX_PATH = '/root/.openclaw/media/inbound/01d24ef2-96da-4d59-baa0-71b15f49d68f.docx';
const SCREENSHOTS = '/root/projects/surveyai/screenshots';
const REPORT_PATH = '/root/projects/surveyai/test-results.md';

mkdirSync(SCREENSHOTS, { recursive: true });

const issues = [];
const passes = [];

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

function issue(severity, location, description) {
  issues.push({ severity, location, description });
  log(`⚠️  [${severity}] ${location}: ${description}`);
}
function pass(location, msg) {
  passes.push({ location, msg });
  log(`✅ ${location}: ${msg}`);
}

async function ss(page, name) {
  try { await page.screenshot({ path: `${SCREENSHOTS}/${name}.png`, fullPage: true }); } catch {}
}

async function waitFor(page, selector, label, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { timeout });
    pass(label, `"${selector}" visible`);
    return true;
  } catch {
    issue('HIGH', label, `Not found: "${selector}" (timeout ${timeout}ms)`);
    return false;
  }
}

async function checkLoading(page, location) {
  // Check if anything is stuck in loading state
  await page.waitForTimeout(500);
  const loadingEl = await page.$('.animate-pulse, [data-loading="true"], [aria-busy="true"], .skeleton');
  if (loadingEl) {
    await page.waitForTimeout(6000);
    const still = await page.$('.animate-pulse, [data-loading="true"], [aria-busy="true"], .skeleton');
    if (still) {
      issue('HIGH', location, 'Loading/skeleton state stuck after 6s — check data fetching');
    } else {
      pass(location, 'Loading resolved within 6s');
    }
  }
}

async function checkConsole(consoleErrors, location) {
  const recent = consoleErrors.splice(0);
  const filtered = recent.filter(e => 
    !e.includes('favicon') && 
    !e.includes('ResizeObserver') &&
    !e.includes('Non-Error promise rejection')
  );
  filtered.slice(0, 5).forEach(e => issue('MEDIUM', `${location} [console]`, e.slice(0, 200)));
}

async function run() {
  const browser = await chromium.launch({ 
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome'
  });
  
  // Desktop
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => issue('HIGH', page.url(), `JS crash: ${err.message.slice(0, 150)}`));
  page.on('response', resp => {
    if (resp.status() >= 500) {
      issue('HIGH', 'API', `${resp.status()} ${resp.url()}`);
    } else if (resp.status() === 404 && resp.url().includes('/api/')) {
      issue('MEDIUM', 'API', `404 ${resp.url()}`);
    }
  });

  // ─── LOGIN ────────────────────────────────────────────────────────────
  log('=== [1/10] LOGIN ===');
  await page.goto(`${BASE_URL}/auth/login`);
  await ss(page, '01-login');
  
  // UI checks
  const pageTitle = await page.title();
  log(`  Page title: "${pageTitle}"`);
  
  const h1 = await page.$('h1');
  if (!h1) issue('LOW', 'Login', 'No H1 heading — branding/title missing');
  
  // Check for misplaced elements
  const loginCard = await page.$('.card, [class*="card"], form');
  if (!loginCard) issue('MEDIUM', 'Login', 'No card/form container found — layout may be broken');
  
  // Check button visibility
  const btn = await page.$('button[type="submit"]');
  if (btn) {
    const box = await btn.boundingBox();
    if (box && box.y > 900) issue('MEDIUM', 'Login', `Submit button is off-screen (y=${box.y})`);
  }

  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  
  try {
    await page.waitForURL(url => !url.includes('/auth/login'), { timeout: 8000 });
    pass('Login', `Authenticated — redirected to ${page.url()}`);
  } catch {
    issue('HIGH', 'Login', `Still on login after submit — check credentials or auth flow. URL: ${page.url()}`);
    await ss(page, '01-login-failed');
    await browser.close();
    return writeReport();
  }
  
  await checkConsole(consoleErrors, 'Login');

  // ─── DASHBOARD ────────────────────────────────────────────────────────
  log('=== [2/10] DASHBOARD ===');
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForTimeout(2000);
  await ss(page, '02-dashboard');
  await checkLoading(page, 'Dashboard');
  
  // Check for key UI elements
  const newProjLink = await page.$('a[href*="/projects/new"], a[href*="new"], button:has-text("New Project"), button:has-text("Create")');
  if (!newProjLink) issue('MEDIUM', 'Dashboard', '"New Project" button/link not found');
  else pass('Dashboard', '"New Project" button present');
  
  // Check for empty state vs projects list
  const emptyState = await page.$('[class*="empty"], text=no projects, text=No projects');
  const projectsList = await page.$$('[class*="project-card"], [data-testid*="project"]');
  log(`  Projects found: ${projectsList.length}, Empty state: ${!!emptyState}`);
  
  await checkConsole(consoleErrors, 'Dashboard');

  // ─── NEW PROJECT ──────────────────────────────────────────────────────
  log('=== [3/10] NEW PROJECT PAGE ===');
  await page.goto(`${BASE_URL}/projects/new`);
  await page.waitForTimeout(2000);
  await ss(page, '03-new-project');
  
  // Step bar
  const stepBar = await page.$('[class*="step"], [data-testid="step"], nav ol, .progress');
  if (!stepBar) issue('MEDIUM', 'New Project', 'Step progress bar not found');
  else pass('New Project', 'Step bar present');
  
  await checkLoading(page, 'New Project');
  await checkConsole(consoleErrors, 'New Project');

  // ─── STEP 1: PROJECT BRIEF ────────────────────────────────────────────
  log('=== [4/10] STEP 1: Project Brief ===');
  // Should already be on step 1 or redirect there
  const step1Url = page.url();
  if (!step1Url.includes('step/1') && !step1Url.includes('/new')) {
    await page.goto(`${BASE_URL}/projects/new`);
    await page.waitForTimeout(1500);
  }
  await ss(page, '04-step1');
  
  // Check form fields
  const nameInput = await page.$('input');
  if (!nameInput) issue('HIGH', 'Step 1', 'No input fields found on project brief step');
  else pass('Step 1', 'Input fields present');
  
  // Try filling the form
  try {
    const inputs = await page.$$('input');
    const textareas = await page.$$('textarea');
    log(`  Inputs: ${inputs.length}, Textareas: ${textareas.length}`);
    
    if (inputs.length > 0) await inputs[0].fill('Test HR Analysis Project');
    if (textareas.length > 0) {
      await textareas[0].fill('RQ1: To what extent do WLB, Workload, and Stress predict Job Satisfaction?');
    }
    
    // Check for "Add RQ" button if multiple RQs supported
    const addRqBtn = await page.$('button:has-text("Add"), button:has-text("+"), button[aria-label*="add"]');
    if (addRqBtn) {
      pass('Step 1', '"Add RQ" button found');
      await addRqBtn.click();
      await page.waitForTimeout(500);
    }
  } catch (e) {
    issue('MEDIUM', 'Step 1', `Form interaction error: ${e.message.slice(0, 100)}`);
  }
  
  await ss(page, '04b-step1-filled');
  
  // Check Next/Submit button
  const nextBtn = await page.$('button:has-text("Next"), button:has-text("Continue"), button[type="submit"]');
  if (!nextBtn) issue('HIGH', 'Step 1', 'No "Next/Continue" button found');
  else {
    pass('Step 1', '"Next" button present');
    // Check it's enabled
    const disabled = await nextBtn.getAttribute('disabled');
    if (disabled !== null) issue('MEDIUM', 'Step 1', '"Next" button is disabled — validation may be blocking');
  }
  
  await checkConsole(consoleErrors, 'Step 1');

  // ─── GET REAL PROJECT ID FROM DASHBOARD ────────────────────────────────
  log('=== [5/10] Finding existing project to test steps 2-7 ===');
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForTimeout(2000);
  
  // Look for any existing project link
  const projectLinks = await page.$$('a[href*="/projects/"]');
  let projectId = null;
  
  for (const link of projectLinks) {
    const href = await link.getAttribute('href');
    if (href && href.match(/\/projects\/[a-z0-9-]{8,}/)) {
      const match = href.match(/\/projects\/([a-z0-9-]+)/);
      if (match && !href.includes('/new')) {
        projectId = match[1];
        log(`  Found project ID: ${projectId}`);
        break;
      }
    }
  }
  
  if (!projectId) {
    issue('HIGH', 'Dashboard', 'No existing projects found — cannot test steps 2-7 with real data');
    log('  Will test step pages with invalid ID to check error handling');
    projectId = 'test-nonexistent-id';
  }

  // ─── STEPS 2-7 ───────────────────────────────────────────────────────
  const stepChecks = [
    { num: 2, name: 'Upload Dataset', selectors: ['input[type="file"]', '[class*="upload"]', '[class*="dropzone"]'] },
    { num: 3, name: 'Column Roles', selectors: ['[class*="column"]', 'table', 'select'] },
    { num: 4, name: 'Quality Overview', selectors: ['[class*="quality"]', '[class*="chart"]', '[class*="missing"]'] },
    { num: 5, name: 'Analysis Plan', selectors: ['[class*="rq"]', '[class*="plan"]', 'button:has-text("Approve")'] },
    { num: 6, name: 'Results', selectors: ['[class*="result"]', '[class*="chart"]', '[class*="badge"]'] },
    { num: 7, name: 'Report', selectors: ['[class*="report"]', '[class*="template"]', 'textarea'] },
  ];
  
  for (const step of stepChecks) {
    log(`=== [${4 + step.num}/10] STEP ${step.num}: ${step.name} ===`);
    await page.goto(`${BASE_URL}/projects/${projectId}/step/${step.num}`);
    await page.waitForTimeout(3000);
    await ss(page, `step${step.num}-${step.name.toLowerCase().replace(/ /g, '-')}`);
    
    const currentUrl = page.url();
    
    // Check for auth redirect (bad)
    if (currentUrl.includes('/auth/login')) {
      issue('HIGH', `Step ${step.num}`, 'Redirected to login — session lost or route not protected correctly');
      continue;
    }
    
    // Check for error pages
    const errorEl = await page.$('[class*="error"], text=Something went wrong, text=Error');
    const notFoundEl = await page.$('text=not found, text=404, h1:has-text("404")');
    
    if (notFoundEl) {
      if (projectId === 'test-nonexistent-id') {
        pass(`Step ${step.num}`, '404 shown for invalid project ID (correct behavior)');
      } else {
        issue('HIGH', `Step ${step.num}`, '404 on real project — route misconfigured');
      }
      continue;
    }
    
    if (errorEl) {
      issue('MEDIUM', `Step ${step.num}`, 'Error state visible — check error boundary and data loading');
    }
    
    // Check loading states
    await checkLoading(page, `Step ${step.num}`);
    
    // Check key selectors
    for (const sel of step.selectors) {
      const el = await page.$(sel);
      if (el) { pass(`Step ${step.num}`, `Found: "${sel}"`); break; }
    }
    
    // Check for old/misplaced UI components
    const floatingElements = await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      const issues = [];
      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' && rect.width > 0 && rect.height > 0) {
          issues.push(el.className);
        }
      });
      return issues.slice(0, 5);
    });
    if (floatingElements.length > 3) {
      issue('LOW', `Step ${step.num}`, `Many fixed-position elements (${floatingElements.length}) — check for modal/overlay stacking`);
    }
    
    await checkConsole(consoleErrors, `Step ${step.num}`);
  }

  // ─── MOBILE RESPONSIVE ────────────────────────────────────────────────
  log('=== [10/10] MOBILE RESPONSIVE CHECK ===');
  const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mobilePage = await mobileContext.newPage();
  
  const mobilePages = [
    { url: `${BASE_URL}/auth/login`, name: 'Login' },
    { url: `${BASE_URL}/dashboard`, name: 'Dashboard' },
    { url: `${BASE_URL}/projects/new`, name: 'New Project' },
  ];
  
  for (const mp of mobilePages) {
    await mobilePage.goto(mp.url);
    await mobilePage.waitForTimeout(1500);
    await mobilePage.screenshot({ path: `${SCREENSHOTS}/mobile-${mp.name.toLowerCase()}.png`, fullPage: true });
    
    const overflow = await mobilePage.evaluate(() => document.body.scrollWidth > window.innerWidth);
    if (overflow) {
      issue('MEDIUM', `Mobile ${mp.name}`, `Horizontal overflow at 375px width`);
    } else {
      pass(`Mobile ${mp.name}`, 'No horizontal overflow');
    }
    
    // Check touch targets
    const smallButtons = await mobilePage.evaluate(() => {
      const btns = document.querySelectorAll('button, a');
      const small = [];
      btns.forEach(b => {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 36) {
          small.push(`${b.tagName}:${b.textContent?.slice(0,20)?.trim()} (h=${Math.round(r.height)}px)`);
        }
      });
      return small.slice(0, 5);
    });
    if (smallButtons.length > 0) {
      issue('LOW', `Mobile ${mp.name}`, `Small touch targets: ${smallButtons.join(', ')}`);
    }
  }
  
  await mobileContext.close();
  await browser.close();
  
  writeReport();
}

function writeReport() {
  const HIGH = issues.filter(i => i.severity === 'HIGH');
  const MEDIUM = issues.filter(i => i.severity === 'MEDIUM');
  const LOW = issues.filter(i => i.severity === 'LOW');

  const report = `# SurveyAI E2E Test Report
Generated: ${new Date().toISOString()}
App: ${BASE_URL}

## Summary
| Severity | Count |
|----------|-------|
| 🔴 HIGH | ${HIGH.length} |
| 🟡 MEDIUM | ${MEDIUM.length} |
| 🔵 LOW | ${LOW.length} |
| **Total** | **${issues.length}** |

---

## 🔴 HIGH Priority (fix immediately)
${HIGH.map((i, n) => `### H${n+1}. ${i.location}\n${i.description}\n`).join('\n') || '_None_'}

---

## 🟡 MEDIUM Priority (fix before release)
${MEDIUM.map((i, n) => `### M${n+1}. ${i.location}\n${i.description}\n`).join('\n') || '_None_'}

---

## 🔵 LOW Priority (nice to have)
${LOW.map((i, n) => `- **${i.location}**: ${i.description}`).join('\n') || '_None_'}

---

## ✅ Passing Checks (${passes.length})
${passes.slice(0, 20).map(p => `- ${p.location}: ${p.msg}`).join('\n')}

---
Screenshots: ${SCREENSHOTS}/
`;

  writeFileSync(REPORT_PATH, report);
  log(`\nReport saved → ${REPORT_PATH}`);
  log(`SUMMARY: ${HIGH.length} HIGH | ${MEDIUM.length} MEDIUM | ${LOW.length} LOW | ${passes.length} passed`);
}

run().catch(e => {
  console.error('CRASH:', e.message);
  writeReport();
  process.exit(1);
});
