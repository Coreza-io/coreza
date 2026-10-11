import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.route('**/workflows/capabilities', route => route.fulfill({ json: { expression_format_version: 1 } }));
  await page.goto('/tests/browser/fixtures/expression-fields.html');
  await expect(page.locator('#number input')).toBeEnabled();
});
test('Number, Boolean, select, multiselect and JSON all accept source without mode controls', async ({ page }) => {
  await page.locator('#number input').fill('{{ $json.count }}');
  await page.locator('#enabled input').fill('{{ false }}');
  await page.locator('#choice input').fill('{{ "b" }}');
  await page.locator('#choices input').fill('{{ ["b"] }}');
  await page.locator('#json textarea').fill('{{ $json }}');
  await expect(page.locator('#resolved')).toHaveText('{"number":3,"enabled":false,"choice":"b","choices":["b"],"json":{"count":3},"dependent":"keep me"}');
  await expect(page.locator('#source')).toContainText('{{ $json.count }}');
  await expect(page.getByText('Value Mode', { exact: true })).toHaveCount(0);
});
test('partial number source survives, pickers write literals, and controlling errors preserve siblings', async ({ page }) => {
  await page.locator('#number input').fill('-');
  await expect(page.locator('#number input')).toHaveValue('-');
  await expect(page.locator('#resolved')).toContainText('Number');
  await page.locator('#number input').fill('0');
  await page.locator('#enabled button[role=switch]').click();
  await expect(page.locator('#source')).toContainText('"enabled":true');
  await page.locator('#choice input').fill('{{');
  await expect(page.locator('#dependent input')).toHaveValue('keep me');
});
test('password source is masked and previews suppress its value', async ({ page }) => {
  await page.locator('#secret input').fill('{{ "private value" }}');
  await expect(page.locator('#secret input')).toHaveAttribute('type', 'password');
  await expect(page.locator('#secret')).not.toContainText('private value');
});

test('HTTP repeater subfields, nested repeaters and object children expose expression source', async ({ page }) => {
  await page.locator('#structured-headers input').nth(1).fill('{{ $json.count }}');
  await page.locator('#structured-form_data input').nth(1).fill('{{ false }}');
  await page.locator('#structured-nested input').fill('{{ $json.count + 1 }}');
  await page.locator('#structured-object input').fill('{{ true }}');
  await expect(page.locator('#structured-resolved')).toContainText('"value":3');
  await expect(page.locator('#structured-resolved')).toContainText('"value":false');
  await expect(page.locator('#structured-resolved')).toContainText('"count":4');
  await expect(page.locator('#structured-resolved')).toContainText('"enabled":true');
  await page.locator('#structured-headers textarea').last().fill('[]');
  await expect(page.locator('#structured-source')).toContainText('"headers":"[]"');
  await expect(page.locator('#structured-resolved')).toContainText('"headers":[]');
});
test('literal false and JSON multiselect source drive their convenience pickers', async ({ page }) => {
  await page.locator('#enabled input').fill('false');
  await expect(page.locator('#enabled button[role=switch]')).toHaveAttribute('aria-checked', 'false');
  await page.locator('#choices input').fill('["b"]');
  await expect(page.locator('#resolved')).toContainText('"choices":["b"]');
  await page.locator('#choice input').fill('{{ "invalid" }}');
  await expect(page.locator('#choice')).toContainText('allowed option');
});
test('rollback capability disables both source controls and convenience pickers', async ({ page }) => {
  await page.unroute('**/workflows/capabilities');
  await page.route('**/workflows/capabilities', route => route.fulfill({ json: { expression_format_version: 0 } }));
  await page.reload();
  await expect(page.locator('#number input')).toBeDisabled();
  await expect(page.locator('#enabled button[role=switch]')).toBeDisabled();
  await expect(page.locator('#structured-headers input').first()).toBeDisabled();
  await expect(page.locator('#custom-repeater').getByRole('button', { name: 'Add condition', exact: false })).toBeDisabled();
});

test('custom repeater maintenance preserves root expressions and explicit empty arrays', async ({ page }) => {
  await expect(page.locator('#custom-repeater-source')).toContainText('"conditions":"{{ $json.rows }}"');
  await expect(page.locator('#custom-repeater-source')).toContainText('"logicalOps":"{{ $json.ops }}"');
  await page.locator('#custom-repeater').getByRole('button', { name: 'Set explicit empty rows' }).click();
  await expect(page.locator('#custom-repeater-source')).toContainText('"conditions":[]');
  await expect(page.locator('#custom-repeater-source')).toContainText('"logicalOps":[]');
  await expect(page.locator('#custom-repeater textarea').first()).toHaveValue('[]');
});

test('Switch root case arrays and If logical operator arrays remain directly editable', async ({ page }) => {
  await page.locator('#switch-repeater textarea').fill('{{ $json.rows[:1] }}');
  await expect(page.locator('#switch-repeater-source')).toContainText('"cases":"{{ $json.rows[:1] }}"');
  await page.locator('#custom-repeater textarea').last().fill('{{ $json.ops }}');
  await expect(page.locator('#custom-repeater-source')).toContainText('"logicalOps":"{{ $json.ops }}"');
});
