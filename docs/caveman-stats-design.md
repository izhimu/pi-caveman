# /caveman-status 统计功能设计

## 目标

扩展 `/caveman-status`，增加当前 session 的 token 使用量和压缩率估算。

## 1. 当前状态

已有输出：
```
Active mode:  wenyan
Default mode: wenyan
User config:  C:\Users\...\config.json
Flag file:    C:\Users\...\.caveman-active
```

缺失：token 统计、压缩率估算。

## 2. caveman 源码参考

基准压缩率（benchmark 测得）：
```javascript
const COMPRESSION = { 'full': 0.65 };
```

计算公式：
```
estWithoutCaveman = outputTokens / (1 - ratio)
estSaved          = estWithoutCaveman - outputTokens
outputReduction   = saved / (saved + used) × 100%
```

## 3. pi 平台 API

| API | 用途 |
|-----|------|
| `turn_end` 事件 | 每个 turn 结束触发，含 `message.usage` |
| `session_start` 事件 | session 开始/恢复时触发 |
| `sessionManager.getBranch()` | 获取当前 session 所有 entries（含历史） |

`AgentMessage.usage` 字段：
```typescript
{
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { input, output, cacheRead, cacheWrite, total };
}
```

## 4. 实现方案

### 4.1 状态变量

```typescript
interface SessionStats {
  turns: number;
  outputTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
}

let sessionStats: SessionStats = {
  turns: 0, outputTokens: 0, cacheReadTokens: 0, inputTokens: 0,
};
```

### 4.2 事件处理

```typescript
// session_start: 重置
pi.on("session_start", () => {
  sessionStats = { turns: 0, outputTokens: 0, cacheReadTokens: 0, inputTokens: 0 };
  // 可选：遍历 getBranch() 重建历史
});

// turn_end: 累加
pi.on("turn_end", (event) => {
  const usage = event.message?.usage;
  if (usage) {
    sessionStats.turns++;
    sessionStats.outputTokens += usage.output;
    sessionStats.cacheReadTokens += usage.cacheRead;
    sessionStats.inputTokens += usage.input;
  }
});
```

### 4.3 压缩率常量

```typescript
const COMPRESSION_RATIOS: Record<string, number> = {
  'full': 0.65,
  'lite': 0.35,
  'ultra': 0.75,
  'wenyan': 0.80,
  'wenyan-lite': 0.60,
  'wenyan-ultra': 0.85,
};
```

> 注：仅 `full` 有实测 benchmark，其余为估算值。

### 4.4 压缩率计算

```typescript
function estimateSavings(outputTokens: number, mode: string) {
  const ratio = COMPRESSION_RATIOS[mode];
  if (!ratio) return null;
  const estWithout = Math.round(outputTokens / (1 - ratio));
  const estSaved = estWithout - outputTokens;
  return { estWithout, estSaved, pct: Math.round(ratio * 100) };
}
```

### 4.5 输出格式

```
Caveman Status
──────────────────────────────────
Active mode:  wenyan
Default mode: wenyan
──────────────────────────────────
Turns:    42
Output tokens:         12,345
Cache-read tokens:     8,901
──────────────────────────────────
Est. without caveman:  61,725
Est. tokens saved:     49,380 (~80% of output)
──────────────────────────────────
User config:  C:\Users\...\config.json
Flag file:    C:\Users\...\.caveman-active
```

## 5. 实现步骤

1. 在 `caveman.ts` 顶部添加 `SessionStats` 接口和 `sessionStats` 变量
2. 添加 `COMPRESSION_RATIOS` 常量
3. 添加 `estimateSavings()` 函数
4. 注册 `session_start` 事件（重置统计）
5. 注册 `turn_end` 事件（累加 token）
6. 扩展 `/caveman-status` handler，追加统计输出

## 6. 范围

仅包含：当前 session 的 token 统计 + 压缩率估算。
不含：跨 session 历史、USD 成本、--share、压缩记忆文件检测、状态栏集成。
