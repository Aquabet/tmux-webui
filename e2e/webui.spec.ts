import { expect, test } from '@playwright/test'

test('登录 → 看到 session → 切 window → 输入并看到回显', async ({ page }) => {
  await page.goto('/')

  // 登录
  await page.getByPlaceholder('密码').fill('secret')
  await page.getByRole('button', { name: '登录' }).click()

  // 侧边栏出现 demo session
  await expect(page.getByRole('button', { name: /demo/ })).toBeVisible()

  // 两个 window tab
  await expect(page.getByRole('button', { name: '0: first' })).toBeVisible()
  await expect(page.getByRole('button', { name: '1: second' })).toBeVisible()

  // 切到第二个 window
  await page.getByRole('button', { name: '1: second' }).click()

  // 在终端输入命令并验证回显
  const term = page.locator('.terminal')
  await term.click()
  await page.keyboard.type('echo e2e-marker-$((40+2))')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-screen')).toContainText('e2e-marker-42', {
    timeout: 10_000,
  })
})

test('密码错误显示错误信息', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('密码').fill('wrong')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('密码错误')).toBeVisible()
})

test('终端可向上滚动查看较早输出', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('密码').fill('secret')
  await page.getByRole('button', { name: '登录' }).click()

  const term = page.locator('.terminal')
  await term.click()
  await page.keyboard.type("for i in $(seq 1 100); do echo scrollback-$i; done")
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-screen')).toContainText('scrollback-100')

  await term.hover()
  await page.mouse.wheel(0, -10_000)
  await expect(page.locator('.xterm-screen')).toContainText('scrollback-1')
})

test('新版提示只在手机顶栏显示，侧栏关闭时仍可见', async ({ page }) => {
  await page.route('**/api/version', async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: {
          current: '3.1.3',
          latest: '3.1.4',
          url: 'https://example.test/v3.1.4',
          updateAvailable: true,
          canUpdate: true,
        },
      },
    })
  })
  await page.goto('/')
  await page.getByPlaceholder('密码').fill('secret')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.locator('.mobile-version')).not.toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.sidebar')).not.toBeInViewport()
  const notice = page.locator('.mobile-version')
  const link = notice.getByRole('link', { name: '新版 v3.1.4' })
  const button = notice.getByRole('button', { name: '更新' })
  await expect(link).toBeVisible()
  await expect(button).toBeVisible()
  expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44)
})
