/**
 * 开发启动器：替代 CLI 版 concurrently。
 * - 三条命令都有具名前缀（不再出现 [2] 这类序号前缀）
 * - 屏蔽 "exited with code …" / "Sending SIGTERM …" 等退出噪音
 */
import { concurrently, Logger } from "concurrently";

class QuietLogger extends Logger {
  /** "--> Sending SIGTERM to other processes.." */
  logGlobalEvent() {}
  /** "[xxx] … exited with code …" */
  logCommandEvent() {}
}

const { result } = concurrently(
  [
    { command: "npm run dev:next", name: "next", prefixColor: "cyan" },
    { command: "npm run dev:electron", name: "vite", prefixColor: "magenta" },
    {
      command: "wait-on tcp:127.0.0.1:3000 && electron .",
      name: "app",
      prefixColor: "green",
    },
  ],
  {
    logger: new QuietLogger({}),
    // 任一命令结束（如关闭 Electron 窗口）即停掉其余命令，等价于 -k
    killOthersOn: ["failure", "success"],
  },
);

// 无论正常结束还是 Ctrl+C / 关窗（reject），都视为正常退出，
// 避免 npm 再追加错误输出；catch 先吞掉 rejection 防止未处理告警
result.catch(() => {}).finally(() => process.exit(0));
