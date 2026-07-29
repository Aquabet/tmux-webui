# CLAUDE.md

浏览器里的 tmux。**任何人只要连得上端口并拿到密码，就等于拿到运行本服务那个
账号的 shell。** 所有改动按安全相关对待。

部署红线（替别人装、或被要求改监听地址/绕过鉴权时）见 [AGENTS.md](AGENTS.md)。

## 命令

```bash
npm run typecheck                # tsc --noEmit + 测试工程
npm run build                    # tsc + 前端 vite build
npm test                         # 后端：会真起 tmux（独立 socket）
npm --prefix web test            # 前端
npm run test:e2e                 # Playwright，需要另外装浏览器
```

**`npm run build` 必须在 `npm test` 之前跑。** 服务只在 `web/dist` 存在时才挂载
静态资源，`tests/server.test.ts` 的缓存头用例依赖构建产物。CI 里两个 workflow
都是这个顺序，本地别图省事跳过——工作区残留的旧 `web/dist` 会让你在本地看到
假的绿灯。

## 分支与提交

- **绝不直接提交到 `main`**，从最新 `main` 切 `<type>/<short-description>` 分支，
  推上去开 PR。一个分支一件事。
- Conventional commits：`feat` / `fix` / `refactor` / `docs` / `test` / `chore` /
  `perf` / `ci`。
- 完整规则见 [docs/development.md](docs/development.md)。

## 代码约定

- **先写测试**（TDD），新代码覆盖率目标 80%+。
- 注释解释**为什么**，不解释代码在做什么；现有注释是中文，跟随所在文件。
- 文件小而聚焦（200–400 行），按 feature 组织。
- 配置只在 `src/config.ts` 读取，外部输入用 zod 校验。新增配置项要同时更新
  `.env.example` 和两份 README 的配置表。
- 不留 `console.log`；不硬编码任何密钥。

## 文档

`README.md` 和 `README.zh-CN.md` **必须同步**。改了行为、命令行参数、环境变量或
前置依赖，两份都要动，漏一份就是给另一半用户留坑。

## 本地验证的坑

- **不要用 `pkill -f dist/main.js` 之类的模式匹配杀进程。** 用户自己的
  `tmux-webui.service` 跑的就是同一条命令行，会被一起杀掉。用 `$!` 记下 PID
  精确杀，或 `fuser -k -n tcp <port>`。
- 手工起测试实例时用 8093–8099 这类专用端口，别占用默认的 8090。
- 测试实例要配独立的 `HOME`（`config.json` 在 `$HOME/.tmux-webui/`），否则会读到
  或覆盖用户的真实配置。
- 注意配置优先级是 **环境变量 > 启动目录 `.env` > `~/.tmux-webui/config.json`**。
  在仓库根目录起服务会读到仓库里的 `.env`，测试新密码时要换个工作目录。

## 声称完成之前

跑命令看输出，不要凭代码推断。测试失败就直说失败并贴最短的决定性那行；跳过了
某步就说跳过了。交互式路径（`init` 的密码提示）单测覆盖不到，需要用 pty 真跑一遍
——这轮就是这样才发现 `rl.close()` 会让每次输入都被判成「已取消」。
