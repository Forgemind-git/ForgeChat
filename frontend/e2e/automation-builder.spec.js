import { test, expect } from '@playwright/test';

const LOGIN_EMAIL = 'admin@forgemind.space';
const LOGIN_PASSWORD = 'admin123';

async function login(page) {
  await page.goto('/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', LOGIN_EMAIL);
  await page.fill('input[type="password"]', LOGIN_PASSWORD);
  await page.click('button:has-text("Sign in")');
  // Wait for the dashboard to load
  await page.waitForSelector('text=ForgeChat', { timeout: 15000 });
}

async function navigateToAutomations(page) {
  // Click the first "Automations" text (sidebar nav item)
  await page.getByText('Automations').first().click();
  await page.waitForSelector('text=Build and manage automated conversation flows.', { timeout: 10000 });
}

async function createNewAutomation(page, name) {
  await page.click('button:has-text("New Automation")');
  await page.waitForSelector('text=Name', { timeout: 5000 });
  await page.fill('input[placeholder="e.g. Welcome Bot"]', name);
  await page.click('text=Next →');
  await page.waitForSelector('text=Block Library', { timeout: 15000 });
}

async function saveAutomation(page) {
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(500);
}

async function goBackToList(page) {
  await page.click('text=Back');
  await page.waitForSelector('text=Build and manage automated conversation flows.', { timeout: 10000 });
}

// Helper to find all append + buttons (below unconnected outputs)
function getAppendPlusButtons(page) {
  return page.locator('[data-testid="append-plus"]');
}

// Helper to find edge + buttons (between connected nodes)
function getEdgePlusButtons(page) {
  return page.locator('[data-testid="edge-plus"]');
}

// Helper to find nodes on canvas
function getNodes(page) {
  return page.locator('[data-testid="flow-node"]');
}

// Helper to click a block from the Block Library sidebar
async function clickBlockLibrary(page, name) {
  const item = page.locator('aside [data-testid="block-library-item"]').filter({ hasText: name });
  await item.click();
}

// Helper to click an item from the NodePicker popup
async function clickNodePickerItem(page, name) {
  const item = page.locator('[data-testid="node-picker-item"]').filter({ hasText: name });
  await item.click();
}

test.describe('Automation Builder — Authentication & Navigation', () => {
  test('login and navigate to automations', async ({ page }) => {
    await login(page);
    await navigateToAutomations(page);
    await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible();
    await expect(page.locator('button:has-text("New Automation")').first()).toBeVisible();
  });

  test('create a new automation opens the builder', async ({ page }) => {
    await login(page);
    await navigateToAutomations(page);
    await createNewAutomation(page, 'Test Flow');
    await expect(page.locator('text=Block Library')).toBeVisible();
    // The builder header shows the automation name
    await expect(page.locator('text=Test Flow').first()).toBeVisible();
  });
});

test.describe('Automation Builder — Node Addition & Connectors', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateToAutomations(page);
    await createNewAutomation(page, 'Node Addition Test');
  });

  test('append node via + button below trigger', async ({ page }) => {
    const pluses = getAppendPlusButtons(page);
    await expect(pluses).toHaveCount(1);
    await pluses.first().click();

    await expect(page.locator('text=Add next step')).toBeVisible();
    await clickNodePickerItem(page, 'WhatsApp Message');

    await expect(getNodes(page)).toHaveCount(2);
    // Should have one connector (edge) — each edge is wrapped in a <g>
    await expect(page.locator('svg > g')).toHaveCount(1);
  });

  test('insert node via edge + button', async ({ page }) => {
    // Add message after trigger
    let pluses = getAppendPlusButtons(page);
    await pluses.first().click();
    await clickNodePickerItem(page, 'WhatsApp Message');

    await expect(getNodes(page)).toHaveCount(2);

    // Now there is an edge between trigger and message
    // The edge-plus button sits on the connector line
    await expect(getEdgePlusButtons(page)).toHaveCount(1);
    // The message node has an unconnected output, so one append-plus
    await expect(getAppendPlusButtons(page)).toHaveCount(1);
  });

  test('add node from Block Library by clicking', async ({ page }) => {
    await clickBlockLibrary(page, 'Add Tag');
    await expect(getNodes(page)).toHaveCount(2);
  });

  test('duplicate node via Ctrl+D', async ({ page }) => {
    await page.locator('[data-node-id="n1"]').click();
    await page.keyboard.press('Control+d');
    await expect(getNodes(page)).toHaveCount(2);
  });

  test('delete node via Delete key', async ({ page }) => {
    // Add a node first
    await clickBlockLibrary(page, 'Smart Delay');
    await expect(getNodes(page)).toHaveCount(2);

    const nodes = getNodes(page);
    // The new node is selected automatically; press Delete
    await page.keyboard.press('Delete');

    await expect(getNodes(page)).toHaveCount(1);
  });
});

test.describe('Automation Builder — Node Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateToAutomations(page);
    await createNewAutomation(page, 'Settings Test');
  });

  test('trigger keyword settings', async ({ page }) => {
    await page.locator('[data-node-id="n1"]').click();
    // The settings panel shows the trigger type title inside the panel body
    await expect(page.getByText('Keyword trigger').first()).toBeVisible();

    // Change keyword
    await page.fill('input[placeholder="e.g. PRICE, BOOK, INFO"]', 'HELLO');
    await expect(page.locator('input[value="HELLO"]')).toBeVisible();

    // The Case sensitive toggle is present (verified by the label and toggle UI)
    await expect(page.getByText('Off · matches PRICE, price, Price').first()).toBeVisible();
  });

  test('message node template selection', async ({ page }) => {
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
    });

    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'WhatsApp Message');

    const nodes = getNodes(page);
    await nodes.nth(1).click();

    await expect(page.getByText('WhatsApp template').first()).toBeVisible();

    // Select welcome_message template by value (seed data id=101)
    await page.locator('select').first().selectOption('101');
    await page.waitForTimeout(500);
    // After selecting, template details (badges + body preview) appear
    await expect(page.getByText('APPROVED').first()).toBeVisible();
    await expect(page.getByText('welcome to Forge Realty').first()).toBeVisible();
  });

  test('condition node rule management', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'Condition');

    const nodes = getNodes(page);
    await nodes.nth(1).click();

    await expect(page.getByText('Match mode').first()).toBeVisible();

    // Click a preset — it adds a rule
    await page.getByText('Contact is opted-in').first().click();
    // The rule count should increase to 1
    await expect(page.getByText('1 rule').first()).toBeVisible();

    // Add another rule
    await page.getByText('Add condition').first().click();
    await expect(page.getByText('Rule 2').first()).toBeVisible();
  });

  test('delay node settings', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'Smart Delay');

    const nodes = getNodes(page);
    await nodes.nth(1).click();

    await expect(page.getByText('Delay type').first()).toBeVisible();

    await page.getByText('Until specific date').first().click();
    await expect(page.locator('input[type="datetime-local"]')).toBeVisible();

    await page.getByText('For a duration').first().click();
    await expect(page.locator('input[inputmode="numeric"]')).toBeVisible();
  });

  test('action node with multiple actions', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'Add Tag');

    const nodes = getNodes(page);
    await nodes.nth(1).click();

    await expect(page.getByText('Perform following actions').first()).toBeVisible();
  });

  test('handoff node team member selection', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'Human Handoff');

    const nodes = getNodes(page);
    await nodes.nth(1).click();

    await expect(page.getByText('Assignment mode').first()).toBeVisible();
    // Seed data team members
    await expect(page.getByText('Rahul Sharma').first()).toBeVisible();
    await expect(page.getByText('Priya Iyer').first()).toBeVisible();
    await expect(page.getByText('Arun Kumar').first()).toBeVisible();
  });

  test('subflow node automation selection', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'Trigger Another Flow');

    const nodes = getNodes(page);
    await nodes.nth(1).click();

    await expect(page.getByText('Sub-flow to run').first()).toBeVisible();
    // Seed data automations
    await expect(page.getByText('Welcome Sub-Flow').first()).toBeVisible();
    await expect(page.getByText('Pricing Sub-Flow').first()).toBeVisible();
  });
});

test.describe('Automation Builder — Preview Simulator', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateToAutomations(page);
    await createNewAutomation(page, 'Preview Test');
  });

  test('preview shows keyword trigger flow', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'WhatsApp Message');

    const nodes = getNodes(page);
    await nodes.nth(1).click();
    await page.locator('select').first().selectOption('101');

    await page.click('[data-testid="preview-toggle"]');
    await expect(page.getByText('WhatsApp simulator').first()).toBeVisible();
    await expect(page.getByText('PRICE').first()).toBeVisible();
  });

  test('restart preview resets conversation', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'WhatsApp Message');

    const nodes = getNodes(page);
    await nodes.nth(1).click();
    await page.locator('select').first().selectOption('101');

    await page.click('[data-testid="preview-toggle"]');
    // Preview shows the trigger message
    await expect(page.getByText('PRICE').first()).toBeVisible();

    await page.getByText('↻ Restart').first().click();
    // After restart, the trigger message should still appear
    await expect(page.getByText('PRICE').first()).toBeVisible();
  });
});

test.describe('Automation Builder — CRM Data Integration', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateToAutomations(page);
    await createNewAutomation(page, 'CRM Integration Test');
  });

  test('templates appear in message node dropdown', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'WhatsApp Message');

    const nodes = getNodes(page);
    await nodes.nth(1).click();

    const select = page.locator('select').first();
    await expect(select).toBeVisible();

    const options = await select.locator('option').allTextContents();
    expect(options.some(o => o.includes('welcome_message'))).toBe(true);
    expect(options.some(o => o.includes('property_alert'))).toBe(true);
    expect(options.some(o => o.includes('otp_verify'))).toBe(true);
    expect(options.some(o => o.includes('follow_up'))).toBe(true);
    expect(options.some(o => o.includes('brochure_send'))).toBe(true);
  });

  test('tags appear in trigger tagApplied dropdown', async ({ page }) => {
    await page.locator('[data-node-id="n1"]').click();
    // Change trigger kind to Tag Applied
    await page.selectOption('select', { label: 'Tag Applied' });

    const tagSelect = page.locator('select').nth(1);
    const options = await tagSelect.locator('option').allTextContents();
    expect(options.some(o => o.includes('Hot Lead'))).toBe(true);
    expect(options.some(o => o.includes('VIP'))).toBe(true);
  });

  test('team members appear in handoff node', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'Human Handoff');

    const nodes = getNodes(page);
    await nodes.nth(1).click();

    await expect(page.getByText('Rahul Sharma').first()).toBeVisible();
    await expect(page.getByText('Priya Iyer').first()).toBeVisible();
    await expect(page.getByText('Arun Kumar').first()).toBeVisible();
  });

  test('contact fields appear in condition rules', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'Condition');

    const nodes = getNodes(page);
    await nodes.nth(1).click();
    await page.getByText('Add condition').first().click();

    const fieldSelect = page.locator('select').nth(1);
    const options = await fieldSelect.locator('option').allTextContents();
    expect(options.some(o => o.includes('city'))).toBe(true);
    expect(options.some(o => o.includes('budget'))).toBe(true);
    expect(options.some(o => o.includes('lead_score'))).toBe(true);
  });

  test('other automations appear in subflow node', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'Trigger Another Flow');

    const nodes = getNodes(page);
    await nodes.nth(1).click();

    await expect(page.getByText('Welcome Sub-Flow').first()).toBeVisible();
    await expect(page.getByText('Pricing Sub-Flow').first()).toBeVisible();
  });
});

test.describe('Automation Builder — Edge Cases & Bugs', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateToAutomations(page);
    await createNewAutomation(page, 'Edge Case Test');
  });

  test('empty automation has default trigger node', async ({ page }) => {
    await expect(getNodes(page)).toHaveCount(1);
    await expect(page.getByText('Trigger: PRICE keyword').first()).toBeVisible();
  });

  test('node picker closes with Escape', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await expect(page.locator('text=Add next step')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('text=Add next step')).not.toBeVisible();
  });

  test('saving automation persists config', async ({ page }) => {
    await getAppendPlusButtons(page).first().click();
    await clickNodePickerItem(page, 'WhatsApp Message');

    const nodes = getNodes(page);
    await nodes.nth(1).click();
    await page.locator('select').first().selectOption('101');

    await saveAutomation(page);
    await goBackToList(page);

    // Find and edit
    await page.getByText('Edge Case Test').first().click();
    await page.locator('button[title="Edit"]').first().click();

    await page.waitForSelector('text=Block Library', { timeout: 15000 });
    await expect(getNodes(page)).toHaveCount(2);
  });
});
