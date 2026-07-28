// 手机端触摸滚动：xterm 在应用开启 mouse tracking 时会忽略 touch 事件，
// 这里把滑动手势累积成 wheel 增量交给调用方合成 WheelEvent，
// 复用桌面滚轮的同一条处理路径（视口滚动或 mouse 上报，xterm 自行分派）。
export interface TouchScroll {
  start(y: number): void
  move(y: number): void
  end(): void
}

export function createTouchScroll(
  emitWheel: (deltaY: number) => void,
  stepPx: number,
): TouchScroll {
  let lastY: number | undefined
  return {
    start(y) {
      lastY = y
    },
    move(y) {
      if (lastY === undefined) return
      // 手指上滑（y 变小）= 正 deltaY = 向下滚看更晚内容，与原生滚动方向一致
      const delta = lastY - y
      if (Math.abs(delta) >= stepPx) {
        emitWheel(delta)
        lastY = y
      }
    },
    end() {
      lastY = undefined
    },
  }
}
