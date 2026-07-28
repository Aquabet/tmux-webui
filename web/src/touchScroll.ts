// 手机端触摸滚动：xterm 在应用开启 mouse tracking 时会忽略 touch 事件，
// 这里把滑动手势累积成 wheel 增量交给调用方合成 WheelEvent，
// 复用桌面滚轮的同一条处理路径（视口滚动或 mouse 上报，xterm 自行分派）。
// end() 返回抬手时的速度（px/ms，正 = 内容向下滚），供调用方做惯性滚动。
export interface TouchScroll {
  start(y: number, t?: number): void
  move(y: number, t?: number): void
  end(t?: number): number
}

// 抬手前若停顿超过该时长，视为刻意停住，不做惯性
const FLING_PAUSE_MS = 100

export function createTouchScroll(
  emitWheel: (deltaY: number) => void,
  stepPx: number,
  clock: () => number = () => performance.now(),
): TouchScroll {
  // anchorY：距上次发射的累积锚点；prevY/prevT：上一次 move，用于瞬时速度
  let anchorY: number | undefined
  let prevY = 0
  let prevT = 0
  let velocity = 0
  return {
    start(y, t = clock()) {
      anchorY = y
      prevY = y
      prevT = t
      velocity = 0
    },
    move(y, t = clock()) {
      if (anchorY === undefined) return
      const dt = t - prevT
      if (dt > 0) {
        // 指数平滑：单帧抖动不至于让惯性速度突变
        velocity = 0.7 * ((prevY - y) / dt) + 0.3 * velocity
        prevY = y
        prevT = t
      }
      // 手指上滑（y 变小）= 正 deltaY = 向下滚看更晚内容，与原生滚动方向一致
      const delta = anchorY - y
      if (Math.abs(delta) >= stepPx) {
        emitWheel(delta)
        anchorY = y
      }
    },
    end(t = clock()) {
      const v = anchorY !== undefined && t - prevT <= FLING_PAUSE_MS ? velocity : 0
      anchorY = undefined
      velocity = 0
      return v
    },
  }
}
