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
