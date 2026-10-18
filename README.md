# 仓境 (CangJing) · 储粮安全三维数字孪生与物联网监控平台

![React](https://img.shields.io/badge/Frontend-React%2019%20%2B%20Vite%207-61DAFB?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/3D%20Twin-React%20Three%20Fiber-000000?logo=threedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Backend-Node.js%20%2B%20Express%205-339933?logo=express&logoColor=white)

面向现代化粮库储粮安全管理的**三维数字孪生态势感知与多维粮情监控工作台**。系统基于 **React 19 + React Three Fiber (`@react-three/fiber` / `drei`) + Express 5** 构建，将粮堆三维温湿度场、气体浓度监测、虫霉风险预警与智能通风作业控制统一于可视化数字孪生场景中。

---

## 核心特性

- **粮仓三维数字孪生视口 (`src/Scene.jsx`)**
  - 基于 Three.js 与自定义仓房三维模型（`3Dmodels/`），支持库区漫游、单仓透视、分层测温电缆阵列点选与热力分布可视化。
- **多源物联网传感与风险预警后端 (`server/`)**
  - 基于 Express 5 构建的 RESTful 服务端，涵盖仓房台账、温湿度/气体传感器时序数据聚合、结露与局部发热风险判别逻辑。
  - 内置安全中间件（`server/security.js`）与业务逻辑单元测试（`server/service.test.js`）。
- **智能通风与出入库作业协同**
  - 根据仓内外温湿差与露点计算通风窗口期，支持通风设备联动控制模拟与作业日志留存。

---

## 快速启动

环境要求：Node.js 20+。

```bash
npm install
npm run dev
```

`npm run dev` 将通过 `concurrently` 同时启动 Express 后端服务（`server/index.js`）与 Vite 前端开发服务（`http://127.0.0.1:5173`）。

### 运行测试与生产构建

```bash
npm test            # 运行服务端核心业务逻辑单元测试
npm run build       # 构建前端生产包
npm start           # 启动生产环境服务端
```

---

## 目录结构

```text
cangjing-grain-platform/
├── src/            # React 19 + React Three Fiber 三维孪生前端源码 (Scene.jsx, main.jsx)
├── server/         # Express 5 后端服务、数据存储、安全校验与单元测试 (service.test.js)
├── 3Dmodels/       # 粮仓与设备三维模型资产
└── index.html      # 应用入口
```
