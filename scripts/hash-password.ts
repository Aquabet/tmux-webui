import { hashPassword } from '../src/auth/password.js'

const password = process.argv[2]
if (!password) {
  console.error('用法: npm run hash-password -- <密码>')
  process.exit(1)
}
const hash = await hashPassword(password)
console.log('写入项目根目录 .env 文件（推荐）：')
console.log(`TMUX_WEBUI_PASSWORD_HASH='${hash}'`)
console.log('')
console.log('或加入 shell 环境：')
console.log(`export TMUX_WEBUI_PASSWORD_HASH='${hash}'`)
