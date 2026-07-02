import { hashPassword } from '../src/auth/password.js'

const password = process.argv[2]
if (!password) {
  console.error('用法: npm run hash-password -- <密码>')
  process.exit(1)
}
const hash = await hashPassword(password)
console.log('把下面这行加入环境（注意用单引号包裹）：')
console.log(`export TMUX_WEBUI_PASSWORD_HASH='${hash}'`)
