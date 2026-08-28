# 🐱 黑喵子围棋

猫娘天才棋手「黑喵子」陪你下围棋：KataGo 引擎对弈 + DeepSeek 大模型实时对话。

- 开局可调：**棋盘大小**（9/13/19）、**黑喵子难度**（入门~职业 5 档）、**让子**（0~9）、**执黑/执白**
- 基础功能：悔棋、Pass、认输、查看领地热力图、终局数子结算、SGF 导出
- 黑喵子对话：AI 每落一子会可爱发言；你可以找她**求助下棋**（她会调 KataGo 给你算最优解）、**悔棋/认输/数子**（直接说就行），也可以纯闲聊

## 技术架构

```
浏览器(Preact + Shudan) ←WebSocket→ Node.js 服务器
                                     ├─ KataGo GTP 引擎（对弈）
                                     ├─ KataGo 分析引擎（求助/热力图/胜率）
                                     ├─ 自研规则引擎（提子/劫/数子）
                                     └─ 黑喵子 Agent（DeepSeek，三层：路由→执行→应答）
```

## 环境要求

- **Windows 10/11**（本仓库已按此开发）
- **NVIDIA 显卡**（OpenCL 即可；若装 CUDA+cuDNN 可切到 CUDA 后端更快）
- **Node.js 18+**（本机若没有，把便携版解压到 `.tools/node-v24.19.0-win-x64`，或直接安装）

## 快速开始

```bat
:: 1. 配置 DeepSeek API Key（没有也可以，黑喵子离线但能下棋）
::    编辑 server\.env，填入 DEEPSEEK_API_KEY=sk-xxxx

:: 2. 安装依赖
npm install

:: 3. 生产模式一键启动（构建前端 + 启动服务器）
start.cmd

:: 或开发模式（前端热更新）
dev.cmd
```

打开浏览器访问 **http://localhost:5177**。

> 首次启动时 KataGo 需要编译 OpenCL 内核（每换一个模型约 5~10 分钟，一次性），
> 编译完成后每次启动都会很快。请耐心等待状态栏「引擎就绪」。

## 引擎与模型

- 引擎：KataGo v1.18.1（`server/data/opencl` 或 `server/data/cuda`，自动选择）
- 模型：`server/data/*.bin.gz`（默认优先 b28 conv 网络，OpenCL 下快；也可放 transformer 网络 `kata1-tf3-*`）
- 后端切换：修改 `server/.env` 的 `KATAGO_BACKEND=cuda`（需自行安装 CUDA 工具包 + cuDNN）

## 黑喵子使用说明

- 在右侧聊天框跟黑喵子说话。示例：
  - 「这步我该怎么下？」→ 黑喵子调 KataGo 给你算当前最佳点
  - 「悔棋」「认输」「帮我数子」「看看地盘」→ 直接执行游戏操作
  - 「今天好累啊」→ 闲聊
- 没配置 API Key 时，聊天框会提示黑喵子离线。

## 开发命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 前后端同时启动（server:5177, client:5173） |
| `npm run build -w client` | 构建前端到 `client/dist` |
| `npm run start -w server` | 只启动服务器（会服务已构建的前端） |
| `npm run typecheck -w server` | 服务器 TypeScript 检查 |
| `check.cmd` | 检查 Node / 引擎 / 模型 / API Key |

## 常见问题

- **启动很慢（几分钟）**：正常，首次 OpenCL 内核编译。
- **状态栏一直「引擎加载中」**：查看 `server/data/server.log` 找报错。
- **想用更强的 transformer 网络**：把 `server/data/kata1-tf3-*.bin.gz` 设为唯一模型
  或设置 `KATAGO_MODEL` 环境变量指向它。
- **CUDA 后端**：安装 NVIDIA CUDA 工具包 + cuDNN 后，`.env` 改 `KATAGO_BACKEND=cuda`。
