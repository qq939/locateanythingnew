# LocateAnything 视频标注工作台

本项目运行在本地 `8082`，目标是围绕视频标注工作流：上传视频、逐帧查看、运行 LocateAnything、把模型输出落成可编辑标注，并在网页上持续展示当前帧和全部帧的标注结果。

## 功能

- 本地视频预览与逐帧跳转
- 当前帧框选、点选、删除、清空
- 调用 `locateanything_worker.py` 支持的任务：
  - `detect`
  - `ground_single`
  - `ground_multi`
  - `ground_text`
  - `detect_text`
  - `ground_gui`
  - `point`
- 当前帧结果列表和全局时间线结果列表
- 保存到 `data/annotations.json`
- 下载标注 JSON
- `/api/model-status` 展示 Python 依赖与模型环境状态

## 启动

```bash
./user_start.sh
```

启动脚本会创建项目内 `.venv`，并安装：

```bash
pip install -r requirements.txt
```

打开：

```text
http://localhost:8082
```

健康检查：

```bash
curl http://localhost:8082/health
curl http://localhost:8082/api/model-status
```

## LocateAnything 接入

本项目包含 NVlabs/Eagle `Embodied/locateanything_worker.py` 的 worker API，并通过 `locateanything_service.py` 包装成 Node 可调用的常驻 Python 子进程。

网页运行 LocateAnything 时会：

1. 把当前 canvas 帧导出为 JPEG base64。
2. `POST /api/locate`。
3. Node 将请求转发给 Python worker。
4. Python 调用 `LocateAnythingWorker("nvidia/LocateAnything-3B")`。
5. 解析 `<box><x1><y1><x2><y2></box>` 和 `<box><x><y></box>`。
6. 前端把 boxes/points 写入当前帧标注并刷新结果列表。

首次真实推理会下载并加载 `nvidia/LocateAnything-3B`，耗时取决于网络、磁盘和设备。开发调试可临时设置：

```bash
LOCATEANYTHING_MOCK=1 ./user_start.sh
```

最终部署默认不启用 mock。
