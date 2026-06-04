# Project Skill

维护这个项目时，核心目标始终是“视频标注工作台”，不是展示页。

## 运行

- 固定端口：`8082`
- 启动：`./user_start.sh`
- 健康检查：`/health`
- 模型环境检查：`/api/model-status`
- 启动模型下载：`POST /api/prepare-model`
- 模型下载进度：`/api/model-progress`

## 架构

- `server.js`：静态页面服务、JSON 保存、LocateAnything Python worker 桥接。
- `locateanything_worker.py`：来自 NVlabs/Eagle 的 LocateAnything worker API。
- `locateanything_service.py`：行分隔 JSON 协议，把 worker 暴露给 Node 子进程。
- `locateanything_model_prepare.py`：Hugging Face 模型预下载任务，写入 `data/model_progress.json` 供网页进度条轮询。
- `public/index.html`：三栏视频标注工作台。
- `public/app.js`：视频帧控制、画布标注、结果列表、导出。
- 批量标注由前端逐帧 seek、截图、调用 `/api/locate` 完成；默认帧间隔 `1` 表示全帧处理。
- `public/style.css`：工作台 UI。

## 交付检查

每次修改后至少检查：

```bash
node --check server.js
python3 -m py_compile locateanything_service.py locateanything_worker.py
curl http://127.0.0.1:8082/health
curl http://127.0.0.1:8082/api/model-status
curl http://127.0.0.1:8082/api/model-progress
```

前端改动要用浏览器或 Playwright 验证：上传视频、当前帧 Locate、全帧/帧段批量 Locate、手动画框、保存 JSON、结果列表可见。
