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

test('侧栏底部固定显示 CPU 与 RAM 仪表', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('密码').fill('secret')
  await page.getByRole('button', { name: '登录' }).click()

  const sidebar = page.locator('.sidebar')
  const resources = page.getByLabel('系统资源占用')
  await expect(resources).toBeVisible()
  await expect(resources.getByLabel(/CPU 使用率/)).toBeVisible()
  await expect(resources.getByLabel(/RAM 使用率/)).toBeVisible()

  const sidebarBox = await sidebar.boundingBox()
  const resourcesBox = await resources.boundingBox()
  expect(sidebarBox).not.toBeNull()
  expect(resourcesBox).not.toBeNull()
  expect(
    Math.abs(
      (sidebarBox?.y ?? 0) +
        (sidebarBox?.height ?? 0) -
        ((resourcesBox?.y ?? 0) + (resourcesBox?.height ?? 0)) -
        12,
    ),
  ).toBeLessThanOrEqual(1)
})

test('桌面侧栏可拖到图标模式、刷新后保留宽度且不影响手机抽屉', async ({ page }) => {
  // 服务端按 IP 限制每分钟 5 次登录；给新增用例独立 IP，避免完整套件第 6 次
  // 登录命中真实限速而让用例顺序互相污染。
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '127.0.0.2' })
  await page.goto('/')
  await page.getByPlaceholder('密码').fill('secret')
  await page.getByRole('button', { name: '登录' }).click()

  const sidebar = page.locator('.sidebar')
  const resizer = page.getByRole('separator', { name: '调整 session 侧栏宽度' })
  const box = await resizer.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move((box?.x ?? 0) + 3, (box?.y ?? 0) + 100)
  await page.mouse.down()
  await page.mouse.move(0, (box?.y ?? 0) + 100, { steps: 5 })
  await page.mouse.up()

  await expect(sidebar).toHaveClass(/compact/)
  await expect(sidebar).toHaveCSS('width', '64px')
  await expect(sidebar.locator('.session-name').first()).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('sidebar-width'))).toBe('64')

  await page.reload()
  await expect(sidebar).toHaveCSS('width', '64px')

  await page.setViewportSize({ width: 390, height: 780 })
  await page.getByRole('button', { name: '切换 session 列表' }).click()
  await expect(sidebar).toHaveCSS('width', '220px')
  await expect(sidebar.locator('.session-name').first()).toBeVisible()
  await expect(resizer).toBeHidden()
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
